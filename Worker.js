var Queue = require('bull'),
	Promise = require('bluebird'),
	config = require('./config'),
	knox = require('knox'),
	redis = require('redis'),
	request = require('superagent'),
	helper = require('./lib/helper'),
	MailParser = require('mailparser').MailParser,
	r = require('rethinkdb'),
	config = require('./config'),
	_ = require('lodash'),
	crypto = require('crypto'),
	dkim = require('./lib/haraka/dkim'),
	SPF = require('./lib/haraka/spf').SPF,
	s3 = knox.createClient(config.s3),
	bunyan = require('bunyan'),
	stream = require('gelf-stream'),
    classifier = require('dermail-spam'),
	log;

var messageQ = new Queue('dermail-api-worker', config.redisQ.port, config.redisQ.host);
var redisStore = redis.createClient(config.redisQ);

if (!!config.graylog) {
	log = bunyan.createLogger({
		name: 'API-Worker',
		streams: [{
			type: 'raw',
			stream: stream.forBunyan(config.graylog.host, config.graylog.port)
		}]
	});
}else{
	log = bunyan.createLogger({
		name: 'API-Worker'
	});
}

var enqueue = function(type, payload) {
	log.debug({ message: 'enqueue: ' + type, payload: payload });
	return messageQ.add({
		type: type,
		payload: payload
	}, config.Qconfig);
}

r.connect(config.rethinkdb).then(function(conn) {
    return classifier.init(conn).then(function() {
        r.conn = conn;

    	log.info('Process ' + process.pid + ' is running as an API-Worker.');

    	messageQ.process(3, function(job, done) {
    		var data = job.data;
    		var type = data.type;
    		data = data.payload;

    		log.info({ message: 'Received Job: ' + type, payload: data });

    		var callback = function(e) {
    			if (e) {
    				log.error({ message: 'Job ' + type + ' returns an error.', error: '[' + e.name + '] ' + e.message, stack: e.stack });
    			}
    			return done(e);
    		}

    		switch (type) {

    			case 'processRaw':

    			var connection = data.connection;
    			var mailPath = connection.tmpPath;
    			var mailParser = new MailParser({
    				streamAttachments: true
    			});

    			var filename = crypto.createHash('md5').update(mailPath).digest("hex");
    			var url = 'https://' + config.s3.bucket + '.' + config.s3.endpoint + '/raw/' + filename;

                mailParser.on('error', function(e) {
                    // Probably errors related to "Error: Encoding not recognized"
                    log.error({ message: 'MailParser stream throws an error', error: '[' + e.name + '] ' + e.message, stack: e.stack });
                    return callback(e);
                });

    			mailParser.on('end', function (mail) {

    				mail._date = _.clone(mail.date);
    				mail.date = connection.date;

    				var spf = new SPF();

    				var putInMail = null;
    				var authentication_results = [];

    				var mailFrom = connection.envelope.mailFrom.address;
    				var domain = mailFrom.substring(mailFrom.lastIndexOf("@") + 1).toLowerCase();

    				var auth_results = function (message) {
    				    if (message) {
    						authentication_results.push(message);
    					}
    				    var header = [ connection.receivedBy ];
    				    header = header.concat(authentication_results);
    				    if (header.length === 1) return '';  // no results
    				    return header.join('; ');
    				};

    				var actual = function(mail) {
    					// dermail-smtp-inbound parseMailStream()

    					if (!mail.text && !mail.html) {
    						mail.text = '';
    						mail.html = '<div></div>';
    					} else if (!mail.html) {
    						mail.html = helper.parse.convertTextToHtml(mail.text);
    					} else if (!mail.text) {
    						mail.text = helper.parse.convertHtmlToText(mail.html);
    					}

    					// dermail-smtp-inbound processMail();

    					mail.connection = connection;
    					mail.cc = mail.cc || [];
    					mail.attachments = mail.attachments || [];
    					mail.envelopeFrom = connection.envelope.mailFrom;
    					mail.envelopeTo = connection.envelope.rcptTo;

    					return enqueue('saveRX', {
    						accountId: data.accountId,
    						userId: data.userId,
    						myAddress: data.myAddress,
    						message: mail
    					})
    					.then(function() {
    						return callback();
    					})
    					.catch(function(e) {
    						return callback(e);
    					})
    				}

    				var spfCallback = function(err, result) {

    					if (!err) {
    						auth_result = spf.result(result).toLowerCase();
    						auth_results( "spf="+auth_result+" smtp.mailfrom="+mailFrom);
    						putInMail = auth_results();
    						mail.spf = auth_result;
    					}

    					mail.authentication_results = putInMail;

    					return actual(mail);
    				}

    				var dkimCallback = function(err, result, dkimResults) {

    					if (dkimResults) {
    						dkimResults.forEach(function (res) {
    							auth_results(
    								'dkim=' + res.result +
    								((res.error) ? ' (' + res.error + ')' : '') +
    								' header.i=' + res.identity
    							);
    						});
    						putInMail = auth_results();
    					}

    					dkimResults = dkimResults || [];
    					mail.dkim = dkimResults;

    					return spf.check_host(connection.remoteAddress, domain, mailFrom, spfCallback)

    				}

    				var verifier = new dkim.DKIMVerifyStream(dkimCallback);
    				var readStream = request.get(url);
    				readStream.on('error', function(e) {
    					log.error({ message: 'Create read stream in processRaw (Auth) throws an error', error: '[' + e.name + '] ' + e.message, stack: e.stack });
    					return callback(e);
    				})

    				readStream.pipe(verifier, { line_endings: '\r\n' });
    			});

    			var readStream = request.get(url);
    			readStream.on('error', function(e) {
    				log.error({ message: 'Create read stream in processRaw (mailParser) throws an error', error: '[' + e.name + '] ' + e.message, stack: e.stack });
    				return callback(e);
    			})

    			readStream.pipe(mailParser);

    			break;

    			case 'saveRX':

    			// Now account and domain are correct, let's:
    			// 1. Assign "from" address in the database
    			// 2. Get our addressId
    			// 3. Assign "to" address in the database
    			// 4. Put the message into the correct folder
    			// 5. Save the attachments
    			// 6. Save the headers
    			// 7. Send new mail notification


    			var accountId = data.accountId;
    			var userId = data.userId;
    			// we need to normalize alias to "canonical" one
    			var myAddress = data.myAddress;
    			var message = data.message;

    			message.savedOn = new Date().toISOString();

    			message.WorkerExtra = {
    				attemptsMade: job.attemptsMade,
    				maxAttempts: job.attempts,
    				delay: job.delay,
    				jobId: job.jobId
    			};

    			return Promise.join(
    				helper.address.getArrayOfAddress(r, accountId, message.to),
    				helper.address.getArrayOfAddress(r, accountId, message.from),
    				helper.address.getArrayOfAddress(r, accountId, message.cc),
    				helper.address.getArrayOfAddress(r, accountId, message.bcc),
    				function(toAddr, fromAddr, ccAddr, bccAddr) {
    					return helper.folder.getInternalFolder(r, accountId, 'Inbox')
    					.then(function(inboxFolder) {
    						return helper.insert.saveMessage(r, accountId, inboxFolder, toAddr, fromAddr, ccAddr, bccAddr, message, false)
    					})
    				}
    			)
    			.then(function(messageId) {
    				return filter(r, accountId, messageId)
    				.then(function(notify) {
    					return helper.folder.getMessageFolder(r, messageId)
    					.then(function(folder) {
    						var payload;
    						if (folder !== null) {
    							payload = {
    								push: notify,
    								userId: userId,
    								accountId: accountId,
    								folder: folder,
    								messageId: messageId,
    								header: folder.displayName + ' at: ' + myAddress,
    								body: message.subject,
    								message: 'New mail in ' + folder.displayName + ' at: ' + myAddress
    							};
    						}else{
    							payload = {
    								push: notify,
    								userId: userId,
    								accountId: accountId,
    								header: folder.displayName + ' at: ' + myAddress,
    								body: message.subject,
    								message: 'New mail in ' + folder.displayName + ' at: ' + myAddress
    							};
    						}
    						return helper.notification.queueNewMailNotification(r, messageQ, config, payload);
    					})
    				})
    			})
    			.then(function() {
    				return callback();
    			})
    			.catch(function(e) {
    				return callback(e);
    			})

    			break;

    			case 'saveTX':

    			var message = data.message;
    			var accountId = message.accountId;

    			delete message.accountId;

                message.savedOn = new Date().toISOString();

    			return Promise.join(
    				helper.address.getArrayOfAddress(r, accountId, message.to),
    				helper.address.getArrayOfAddress(r, accountId, message.from),
    				helper.address.getArrayOfAddress(r, accountId, message.cc),
    				helper.address.getArrayOfAddress(r, accountId, message.bcc),
    				function(toAddr, fromAddr, ccAddr, bccAddr) {
    					return helper.folder.getInternalFolder(r, accountId, 'Sent')
    					.then(function(sentFolder) {
    						return helper.insert.saveMessage(r, accountId, sentFolder, toAddr, fromAddr, ccAddr, bccAddr, message, true)
    					})
    				}
    			)
    			.then(function() {
    				return callback();
    			})
    			.catch(function(e) {
    				return callback(e);
    			})

    			break;

    			case 'queueTX':

    			var servers = _.cloneDeep(config.tx);

    			servers.sort(function(a,b) {return (a.priority > b.priority) ? 1 : ((b.priority > a.priority) ? -1 : 0);} );

    			var send = function(servers, data) {
    				if (servers.length === 0) {
    					return helper.notification.sendAlert(r, data.userId, 'error', 'No more outbound servers available.')
    					.then(function(queueId) {
    						callback();
    					})
    					.catch(function(e) {
    						callback();
    					});
    				}
    				var server = servers.shift();
    				var hook = server.hook;
    				request
    				.post(hook)
    				.timeout(10000)
    				.set('X-remoteSecret', config.remoteSecret)
    				.send(data)
    				.set('Accept', 'application/json')
    				.end(function(err, res){
    					if (err !== null || res.body.ok !== true) {
    						return helper.notification.sendAlert(r, data.userId, 'error', 'Trying another outbound server.')
    						.then(function(queueId) {
    							send(servers, data);
    						})
    						.catch(function(e) {
    							callback(e);
    						});
    					}
    					return helper.notification.sendAlert(r, data.userId, 'log', 'Queued for delivery.')
    					.then(function(queueId) {
    						callback();
    					})
    					.catch(function(e) {
    						callback(e);
    					});
    				});
    			}

    			send(servers, data);

    			break;

    			case 'truncateFolder':

    			return Promise.map(data.messages, function(message) {

    				var deleteMessage = function() {
    					return r
    					.table('messages')
    					.get(message.messageId)
    					.delete()
    					.run(r.conn)
    				};

    				var deleteHeader = function() {
    					return r
    					.table('messageHeaders')
    					.get(message.headers)
    					.delete()
    					.run(r.conn);
    				};

    				var queueDeleteAttachment = function() {
    					return Promise.map(message.attachments, function(attachmentId) {
    						return enqueue('checkUnique', attachmentId)
    					}, { concurrency: 3 });
    				}

    				return Promise.all([
    					deleteMessage(),
    					deleteHeader(),
    					queueDeleteAttachment()
    				])
    			}, { concurrency: 3 })
    			.then(function() {
    				return helper.notification.sendAlert(r, data.userId, 'success', 'Folder truncated.')
    			})
    			.then(function() {
    				return callback();
    			})
    			.catch(function(e) {
    				return callback(e);
    			})

    			break;

    			case 'checkUnique':

    			deleteIfUnique(r, data)
    			.then(function(attachment) {
    				if (!attachment.hasOwnProperty('doNotDeleteS3')) {
    					return enqueue('deleteAttachment', {
    						attachmentId: attachment.attachmentId,
    						checksum: attachment.checksum,
    						generatedFileName: attachment.generatedFileName
    					});
    				}
    			})
    			.then(function() {
    				return deleteAttachmentFromDatabase(r, data);
    			})
    			.then(function() {
    				return callback();
    			})
    			.catch(function(e) {
    				return callback(e);
    			})

    			break;

    			case 'deleteAttachment':

    			deleteAttachmentOnS3(data.checksum, data.generatedFileName, s3)
    			.then(function() {
    				return callback();
    			})
    			.catch(function(e) {
    				return callback(e);
    			})

    			break;

    			case 'pushNotification':

    			var userId = data.userId;
    			return r
    			.table('pushSubscriptions')
    			.get(userId)
    			.run(r.conn)
    			.then(function(result) {
    				if (result !== null) {
    					return Promise.map(result.subscriptions, function(subscription) {
    						return helper.notification.sendNotification(r, config.gcm_api_key, data, subscription);
    					}, { concurrency: 3 });
    				}
    			})
    			.then(function() {
    				return callback();
    			})
    			.catch(function(e) {
    				return callback(e);
    			})

    			break;
    		}
    	});
    })
});

var deleteIfUnique = Promise.method(function(r, attachmentId) {
	var doNotDeleteS3 = {
		doNotDeleteS3: true
	};
	return r
	.table('attachments')
	.get(attachmentId)
	.run(r.conn)
	.then(function(attachment) {
		if (attachment === null) { // ok... that's weird...
			return doNotDeleteS3;
		}
		return r
		.table('attachments')
		.getAll(attachment.checksum, {index: 'checksum'})
		.count()
		.run(r.conn)
		.then(function(count) {
			if (count === 1) { // Last copy, go for it
				return attachment;
			}else{ // Other attachments have the same checksum, don't delete
				return doNotDeleteS3;
			}
		})
	})
})

var deleteAttachmentOnS3 = function(checksum, generatedFileName, s3) {
	return new Promise(function(resolve, reject) {
		var key = checksum + '/' + generatedFileName;
		s3.deleteFile(key, function(err, res){
			if (err) {
				return reject(err);
			}else{
				return resolve(res);
			}
		});
	});
}

var deleteAttachmentFromDatabase = function(r, attachmentId) {
	return r
	.table('attachments')
	.get(attachmentId)
	.delete()
	.run(r.conn)
}

var filter = function (r, accountId, messageId) {
	var notify = true;
	return new Promise(function(resolve, reject) {
		return helper.filter.getFilters(r, accountId, false)
		.then(function(filters) {
			return r
			.table('messages', {readMode: 'majority'})
			.get(messageId)
			.merge(function(doc) {
				return {
                    'attachments': doc('attachments').concatMap(function(attachment) { // It's like a subquery
                        return [r.table('attachments', {readMode: 'majority'}).get(attachment)]
                    }),
					'to': doc('to').concatMap(function(to) { // It's like a subquery
						return [r.table('addresses', {readMode: 'majority'}).get(to).without('accountId', 'addressId', 'internalOwner')]
					}),
					'from': doc('from').concatMap(function(from) { // It's like a subquery
						return [r.table('addresses', {readMode: 'majority'}).get(from).without('accountId', 'addressId', 'internalOwner')]
					})
				}
			})
			.run(r.conn)
			.then(function(message) {
				if (filters.length === 0) {
					return applyDefaultFilter(r, accountId, messageId, message)
					.then(function(doNotNotify) {
						notify = !doNotNotify;
					})
				}else{
					var results = [message];
					var once = false;
					return Promise.mapSeries(filters, function(filter) {
						if (once) return;
						var criteria = filter.pre;
						return helper.filter.applyFilters(results, criteria.from, criteria.to, criteria.subject, criteria.contain, criteria.exclude)
						.then(function(filtered) {
							// It will always be a length of 1
							if (filtered.length !== 1) return;
							once = true;
							return Promise.map(Object.keys(filter.post), function(key) {
								if (key === 'doNotNotify') {
									notify = !filter.post.doNotNotify;
								}else{
									return helper.filter.applyAction(r, key, filter.post[key], message);
								}
							}, { concurrency: 3 });
						})
					})
					.then(function() {
						if (once) return;
						return applyDefaultFilter(r, accountId, messageId, message)
						.then(function(doNotNotify) {
							notify = !doNotNotify;
						})
					})
				}
			})
		})
		.then(function() {
			return helper.notification.checkAccountNotify(r, accountId)
			.then(function(accountSetting) {
				if (accountSetting === true && notify === true) {
					notify = true;
				}else{
					notify = false;
				}
				return resolve(notify);
			})
		})
		.catch(function(e) {
			return reject(e);
		})
	});
}

var applyDefaultFilter = Promise.method(function(r, accountId, messageId, message) {
	var dstFolderName = null;
	var doNotNotify = false;
    return classifier.categorize(message, true).then(function(probs) {
        var cat = (probs === null) ? null : probs[0].cat;
        log.debug({ message: 'Bayesian filter result: ' + cat, payload: {
            messageId: messageId,
            probs: probs
        } });
        if (cat === null) {
            // Fall back in case of a new installation
            if (helper.filter.isFalseReply(message) || !helper.filter.isSPFAndDKIMValid(message)) {
        		// If the message has "Re:" in the subject, but has no inReplyTo, it is possibly a spam
        		// Therefore, we will default it to SPAM, and override notification to doNotNotify

                // By default, Dermail spams emails without SPF or failing the SPF test;
        		// and spams emails with invalid DKIM signature
        		dstFolderName = 'Spam';
        		doNotNotify = true;
        	}
        }else if (cat === 'Spam') {
            // We will put our full faith into the Bayes classifier
            dstFolderName = 'Spam';
            doNotNotify = true;
        }else{
            return;
        }

        return helper.folder.getInternalFolder(r, accountId, dstFolderName)
        .then(function(dstFolder) {
            return r
            .table('messages', {readMode: 'majority'})
            .get(messageId)
            .update({
                folderId: dstFolder
            })
            .run(r.conn)
        })
    })
    .then(function() {
        return doNotNotify;
    })
})

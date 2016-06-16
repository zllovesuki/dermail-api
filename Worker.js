var Queue = require('bull'),
	Promise = require('bluebird'),
	config = require('./config'),
	knox = require('knox'),
	request = require('superagent'),
	helper = require('./lib/helper'),
	r = require('rethinkdb'),
	config = require('./config'),
	_ = require('lodash'),
	s3 = knox.createClient(config.s3),
	bunyan = require('bunyan'),
	stream = require('gelf-stream'),
	log;

var messageQ = new Queue('dermail-api-worker', config.redisQ.port, config.redisQ.host);

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

r.connect(config.rethinkdb).then(function(conn) {
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
			//var myAddress = recipient;

			message.WorkerExtra = {
				attemptsMade: job.attemptsMade,
				maxAttempts: job.attempts,
				delay: job.delay,
				jobId: job.jobId
			};

			return Promise.join(
				helper.address.getArrayOfToAddress(r, accountId, myAddress, message.to),
				helper.address.getArrayOfFromAddress(r, accountId, message.from),
				function(arrayOfToAddress, arrayOfFromAddress) {
					return helper.folder.getInternalFolder(r, accountId, 'Inbox')
					.then(function(inboxFolder) {
						return helper.insert.saveMessage(r, accountId, inboxFolder, arrayOfToAddress, arrayOfFromAddress, message, false)
					})
				}
			)
			.then(function(messageId) {
				return filter(r, accountId, messageId)
				.then(function(notify) {
					if (!notify) return;
					return helper.folder.getMessageFolder(r, messageId)
					.then(function(folder) {
						var payload;
						if (folder !== null) {
							payload = {
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
			var myAddress = message.myAddress;

			delete message.accountId;
			delete message.myAddress;

			return Promise.join(
				// Perspective is relative. "From" in the eyes of RX, "To" in the eyes of TX
				helper.address.getArrayOfFromAddress(r, accountId, message.to),
				// Perspective is relative. "To" in the eyes of RX, "From" in the eyes of TX
				helper.address.getArrayOfToAddress(r, accountId, myAddress, message.from),
				function(arrayOfToAddress, arrayOfFromAddress) {
					return helper.folder.getInternalFolder(r, accountId, 'Sent')
					.then(function(sentFolder) {
						return helper.insert.saveMessage(r, accountId, sentFolder, arrayOfToAddress, arrayOfFromAddress, message, true)
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

			data.remoteSecret = config.remoteSecret;

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
						return messageQ.add({
							type: 'checkUnique',
							payload: attachmentId
						}, config.Qconfig);
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
					return messageQ.add({
						type: 'deleteAttachment',
						payload: {
							attachmentId: attachment.attachmentId,
							checksum: attachment.checksum,
							generatedFileName: attachment.generatedFileName
						}
					}, config.Qconfig);
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
							if (filtered.length === 1) {
								once = true;
								return Promise.map(Object.keys(filter.post), function(key) {
									if (key === 'doNotNotify') {
										notify = !filter.post.doNotNotify;
									}else{
										return helper.filter.applyAction(r, key, filter.post[key], message);
									}
								}, { concurrency: 3 });
							}
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
			return resolve(notify);
		})
		.catch(function(e) {
			return reject(e);
		})
	});
}

var applyDefaultFilter = Promise.method(function(r, accountId, messageId, message) {
	var dstFolderName = null;
	var doNotNotify = false;
	if (helper.filter.isFalseReply(message)) {
		// If the message has "Re:" in the subject, but has no inReplyTo, it is possibly a spam
		// Therefore, we will default it to SPAM, and override notification to doNotNotify
		dstFolderName = 'Spam';
		doNotNotify = true;
	}
	if (!helper.filter.isSPFAndDKIMValid(message)) {
		// By default, Dermail spams emails without SPF or failing the SPF test;
		// and spams emails with invalid DKIM signature
		dstFolderName = 'Spam';
		doNotNotify = true;
	}
	if (dstFolderName !== null) {
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
		.then(function() {
			return doNotNotify;
		})
	}else{
		return doNotNotify;
	}
})

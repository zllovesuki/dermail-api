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

	messageQ.process(function(job, done) {
		var data = job.data;
		var type = data.type;
		data = data.payload;

		log.info({ message: 'Received Job' + type, payload: data });

		var callback = function(err) {
			if (err) {
				log.error(err);
			}
			return done(err);
		}

		switch (type) {
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

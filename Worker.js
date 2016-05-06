var Queue = require('bull'),
	Promise = require('bluebird'),
	config = require('./config'),
	knox = require('knox'),
	request = require('superagent'),
	helper = require('./lib/helper'),
	r = require('rethinkdb'),
	config = require('./config'),
	_ = require('lodash'),
	s3 = knox.createClient(config.s3);

var messageQ = new Queue('dermail-api-worker', config.redisQ.port, config.redisQ.host);

r.connect(config.rethinkdb).then(function(conn) {
	r.conn = conn;
	console.log('Process ' + process.pid + ' is running as an API-Worker.')
	messageQ.process(function(job, done) {
		var data = job.data;
		var type = data.type;
		data = data.payload;

		switch (type) {
			case 'sendMail':

			sendNotification(r, data.userId, 'log', 'Queued for delivery.')
			.then(function(queueId) {
				var servers = _.cloneDeep(config.tx);

				servers.sort(function(a,b) {return (a.priority > b.priority) ? 1 : ((b.priority > a.priority) ? -1 : 0);} );

				var send = function(servers, data) {
					if (servers.length === 0) {
						var errorMsg = 'No more outbound servers available.'
						return sendNotification(r, data.userId, 'error', errorMsg)
						.then(function(queueId) {
							done();
						})
						.catch(function(e) {
							done();
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
						if (err !== null || res.body.error !== null) {
							return sendNotification(r, data.userId, 'error', 'Trying another outbound server.')
							.then(function(queueId) {
								send(servers, data);
							})
							.catch(function(e) {
								done(e);
							});
						}
						return sendNotification(r, data.userId, 'success', 'Message sent.')
						.then(function(queueId) {
							done();
						})
						.catch(function(e) {
							done(e);
						});
					});
				}

				send(servers, data);
			})
			.catch(function(e) {
				return done(e);
			});

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
				return done();
			})
			.catch(function(e) {
				return done(e);
			})

			break;

			case 'deleteAttachment':

			deleteAttachmentOnS3(data.checksum, data.generatedFileName, s3)
			.then(function() {
				return done();
			})
			.catch(function(e) {
				return done(e);
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
						return helper.notification.sendNotification(r, config.gcm_api_key, {
							message: data.message,
							accountId: data.accountId
						}, subscription);
					}, { concurrency: 3 });
				}
			})
			.then(function() {
				return done();
			})
			.catch(function(e) {
				return done(e);
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

var sendNotification = Promise.method(function(r, userId, level, msg) {
	var insert = {};
	insert.userId = userId;
	insert.type = 'notification';
	insert.level = level;
	insert.message = msg;
	return r
	.table('queue')
	.insert(insert)
	.getField('generated_keys')
	.do(function (keys) {
		return keys(0);
	})
	.run(r.conn)
	.then(function(queueId) {
		return queueId;
	})
})

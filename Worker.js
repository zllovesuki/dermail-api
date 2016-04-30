var Queue = require('bull'),
	Promise = require('bluebird'),
	config = require('./config'),
	knox = require('knox'),
	request = require('superagent'),
	r = require('rethinkdb'),
	config = require('./config'),
	_ = require('lodash'),
	s3 = knox.createClient(config.s3);

var messageQ = new Queue('dermail-send', config.redisQ.port, config.redisQ.host);

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
							return done(errorMsg);
						})
						.catch(function(e) {
							return done(e);
						});
					}
					var server = servers.shift();
					var hook = server.hook;
					return request
					.post(hook)
					.timeout(10000)
					.send(data)
					.set('Accept', 'application/json')
					.end(function(err, res){
						if (err !== null || res.body.error !== null) {
							return sendNotification(r, data.userId, 'error', 'Trying another outbound server.')
							.then(function(queueId) {
								return send(servers, data);
							})
							.catch(function(e) {
								return done(e);
							});
						}
						return sendNotification(r, data.userId, 'success', 'Message sent.')
						.then(function(queueId) {
							return done();
						})
						.catch(function(e) {
							return done(e);
						});
					});
				}

				return send(servers, data);
			})
			.catch(function(e) {
				return done(e);
			});
			break;
			case 'deleteAttachment':
			deleteAttachmentOnS3(r, data, s3)
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
		}
	});
});

var deleteAttachmentOnS3 = function(r, attachmentId, s3) {
	return new Promise(function(resolve, reject) {
		r
		.table('attachments')
		.get(attachmentId)
		.run(r.conn)
		.then(function(attachment) {
			var key = attachment.checksum + '/' + attachment.generatedFileName;
			s3.deleteFile(key, function(err, res){
				if (err) {
					return reject(err);
				}else{
					return resolve(res);
				}
			});
		})
	});
}

var deleteAttachmentFromDatabase = function(r, attachmentId) {
	return r
	.table('attachments')
	.get(attachmentId)
	.delete()
	.run(r.conn)
}

var sendNotification = function (r, userId, level, msg) {
	return new Promise(function(resolve, reject) {
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
			return resolve(queueId);
		})
		.error(function(e) {
			return reject(e);
		})
	})
}

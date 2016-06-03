var r = require('rethinkdb'),
	config = require('../config'),
	knox = require('knox'),
	async = require('async'),
	crypto = require('crypto'),
	dkim = require('dkim-verify'),
	s3 = knox.createClient(config.s3);

var onS3 = {};
var inDB = {};
var raw = {};

var update = function(r, messageId, dkim) {
	return r
	.table('messages')
	.get(messageId)
	.update({
		dkim: dkim
	})
	.run(r.conn)
}

s3.list({ prefix: 'raw/'}, function(err, data){
	if (err) {
		throw err;
	}
	r.connect(config.rethinkdb).then(function(conn) {
		r.conn = conn;
		async.waterfall([
			function(done) {
				async.each(data.Contents, function(file, cb) {
					var key = file.Key;
					var name = key.substring(key.indexOf("/") + 1).toLowerCase();
					onS3[name] = key;
					cb();
				}, function(err) {
					done();
				});
			},
			function(done) {
				r
				.table('messages')
				.run(r.conn)
				.then(function(cursor) {
					return cursor.toArray();
				})
				.then(function(results) {
					async.each(results, function(res, cb) {
						if (res.connection) {
							var tmpPath = res.connection.tmpPath;
							var hash = crypto.createHash('md5')
							hash.update(tmpPath);
							inDB[hash.digest('hex')] = res.messageId;
						}
						cb();
					}, function(err) {
						done();
					});
				})
			}
		], function(err) {
			async.each(Object.keys(onS3), function(hash, cb) {
				if (typeof inDB[hash] !== 'undefined') {
					raw[hash] = inDB[hash];
				}
				cb();
			}, function(err) {
				async.each(Object.keys(raw), function(file, _cb) {
					s3.get('/raw/' + file)
					.on('response', function(res) {
						var verify = new dkim();
						verify.on('end', function(results) {
							update(r, raw[file], results).then(function() {
								_cb()
							});
						})

						verify.on('error', function(error) {
							update(r, raw[file], error).then(function() {
								_cb()
							});
						})

						res.pipe(verify);
					})
					.end();
				}, function(err) {
					conn.close();
				})
			});
		})
	});
})

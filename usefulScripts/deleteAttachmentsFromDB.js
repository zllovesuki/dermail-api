var r = require('rethinkdb'),
	config = require('../config'),
	async = require('async');

var inDB = [];
var inMessages = [];
var pendingDelete = [];

r.connect(config.rethinkdb).then(function(conn) {
	async.waterfall([
		function(done) {
			r
			.table('messages')
			.getField('attachments')
			.run(conn)
			.then(function(cursor) {
				return cursor.toArray();
			})
			.then(function(results) {
				async.each(results, function(res, cb) {
					res.forEach(function(attachment) {
						inMessages.push(attachment);
					})
					cb();
				}, function(err) {
					done();
				});
			})
		},
		function(done) {
			r
			.table('attachments')
			.pluck('attachmentId')
			.run(conn)
			.then(function(cursor) {
				return cursor.toArray();
			})
			.then(function(results) {
				async.each(results, function(res, cb) {
					inDB.push(res.attachmentId);
					cb();
				}, function(err) {
					done();
				});
			})
		}
	], function(err) {
		async.each(inDB, function(attachment, cb) {
			if (inMessages.indexOf(attachment) === -1) {
				console.log(attachment + ' exists in table `attachment` but not `messages`:');
				pendingDelete.push(attachment);
			}
			cb();
		}, function(err) {
			async.each(pendingDelete, function(attachmentId, cb) {
				r
				.table('attachments')
				.get(attachmentId)
				.delete()
				.run(conn)
				.then(function() {
					cb();
				})
			}, function(err) {
				conn.close();
			});
		});
	})
});

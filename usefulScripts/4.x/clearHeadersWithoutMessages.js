var r = require('rethinkdb'),
	config = require('../config'),
	async = require('async');

var headersInDB = [];
var headersInMessages = [];
var pendingDelete = [];

r.connect(config.rethinkdb).then(function(conn) {
	async.waterfall([
		function(done) {
			r
			.table('messageHeaders')
			.getField('headerId')
			.run(conn)
			.then(function(cursor) {
				return cursor.toArray();
			})
			.then(function(results) {
				async.each(results, function(headerId, cb) {
					headersInDB.push(headerId);
					cb();
				}, function(err) {
					done();
				});
			})
		},
		function(done) {
			r
			.table('messages')
			.getField('headers')
			.run(conn)
			.then(function(cursor) {
				return cursor.toArray();
			})
			.then(function(results) {
				async.each(results, function(headers, cb) {
					headersInMessages.push(headers);
					cb();
				}, function(err) {
					done();
				});
			})
		}
	], function(err) {
		async.each(headersInDB, function(headerId, cb) {
			if (headersInMessages.indexOf(headerId) === -1) {
				console.log(headerId + ' exists in table `messageHeaders` but not `messages`:');
				pendingDelete.push(headerId);
			}
			cb();
		}, function(err) {
			async.each(pendingDelete, function(headerId, cb) {
				r
				.table('messageHeaders')
				.get(headerId)
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

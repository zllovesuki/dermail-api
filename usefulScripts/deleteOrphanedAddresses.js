var r = require('rethinkdb'),
	config = require('../config'),
	helper = require('../lib/helper'),
	Promise = require('bluebird');

var deleted = [];

r.connect(config.rethinkdb).then(function(conn) {
	r.conn = conn;
	return r
	.table('addresses')
	.pluck('addressId', 'aliasOf')
	.map(function(doc) {
		return {
			addressId: doc('addressId'),
			alias: r.branch(doc.hasFields('aliasOf'), true, false),
			count: r
			.table('messages')
			.pluck('to', 'from')
			.filter(function(_doc) {
				return _doc('from').contains(doc('addressId')).or(_doc('to').contains(doc('addressId')))
			})
			.count()
		}
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(results) {
		return Promise.map(results, function(result) {
			if (result.count === 0 && result.alias === false) {
				deleted.push(result.addressId)
				return r.table('addresses').get(result.addressId).delete().run(r.conn);
			}
		})
	})
	.then(function() {
		console.log(deleted);
		conn.close();
	})
});

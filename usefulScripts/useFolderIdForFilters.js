var r = require('rethinkdb'),
	config = require('../config');

r.connect(config.rethinkdb).then(function(conn) {
	r.table('filters').map(function(doc) {
		return doc.merge(function() {
			return {
				folder: r.table('folders').getAll([doc('accountId'), doc('post')('folder')], {
					index: 'accountIdInbox'
				}).coerceTo('array')
			}
		})
	})
	.forEach(function(doc) {
		return r.table('filters').get(doc('filterId')).update({
			post: {
				doNotNotify: doc('post')('doNotNotify'),
				folder: doc('folder')(0)('folderId'),
				markRead: doc('post')('markRead'),
			}
		})
	})
	.run(conn)
	.then(function() {
		conn.close();
	})
})

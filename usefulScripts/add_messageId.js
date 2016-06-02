var r = require('rethinkdb'),
	config = require('../config');

r.connect(config.rethinkdb).then(function(conn) {
	r
	.table('messages')
	.filter(function(doc) {
		return r.not(doc.hasFields('_messageId'))
	})
	.forEach(function(doc) {
		return r.table('messages').get(doc('messageId')).update({
			_messageId: doc('messageId')
		})
	})
	.run(conn)
	.then(function() {
		conn.close();
	})
})

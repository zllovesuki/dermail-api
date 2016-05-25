var r = require('rethinkdb'),
	config = require('../config'),
	mailcomposer = require("mailcomposer");

r.connect(config.rethinkdb).then(function(conn) {
	r
	.db('dermail')
	.table('messages')
	.get(process.argv[2])
	.without('text')
	// Save some bandwidth and processsing
	.merge(function(doc) {
		return {
			'to': doc('to').concatMap(function(to) { // It's like a subquery
				return [r.table('addresses').get(to).without('accountId', 'addressId', 'internalOwner')]
			}),
			'from': doc('from').concatMap(function(from) { // It's like a subquery
				return [r.table('addresses').get(from).without('accountId', 'addressId', 'internalOwner')]
			}),
			'headers': r.table('messageHeaders').get(doc('headers')).without('accountId'),
			'attachments': doc('attachments').concatMap(function(attachment) { // It's like a subquery
				return [r.table('attachments').get(attachment)]
			})
		}
	})
	.merge(function(doc) {
		return {
			'to': doc('to').concatMap(function(to) { // It's like a subquery
				return [{
					'name': to('friendlyName'),
					'address': to('account').add('@').add(to('domain'))
				}]
			}),
			'from': doc('from').concatMap(function(from) { // It's like a subquery
				return [{
					'name': from('friendlyName'),
					'address': from('account').add('@').add(from('domain'))
				}]
			}),
			'messageId': r.branch(doc.hasFields('_messageId'), doc('_messageId'), null)
		}
	})
	.run(conn)
	.then(function(mail) {
		if (mail === null) {
			console.log('Mail does not exist');
		}else{
			mail.date = new Date(mail.date).toUTCString().replace(/GMT/g, '-0000');
			var compose = mailcomposer(mail);
			var stream = compose.createReadStream();
			stream.pipe(process.stdout);
		}
		conn.close();
	})
});

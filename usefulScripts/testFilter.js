var r = require('rethinkdb'),
	config = require('../config'),
	helper = require('../lib/helper'),
	Promise = require('bluebird');

r.connect(config.rethinkdb).then(function(conn) {
	r.conn = conn;
	return helper.filter.getFilters(r, process.argv[2], false)
	.then(function(filters) {
		if (filters.length === 0) return; // Early surrender if account has no filters
		return r
		.table('messages')
		.get(process.argv[3])
		.merge(function(doc) {
			return {
				'to': doc('to').concatMap(function(to) { // It's like a subquery
					return [r.table('addresses').get(to).without('accountId', 'addressId', 'internalOwner')]
				}),
				'from': doc('from').concatMap(function(from) { // It's like a subquery
					return [r.table('addresses').get(from).without('accountId', 'addressId', 'internalOwner')]
				})
			}
		})
		.pluck('from', 'to', 'subject', 'text', 'messageId', 'accountId')
		.run(r.conn)
		.then(function(message) {
			var results = [message];
			var once = false;
			return Promise.mapSeries(filters, function(filter) {
				if (once) return;
				var criteria = filter.pre;
				return helper.filter.applyFilters(results, criteria.from, criteria.to, criteria.subject, criteria.contain, criteria.exclude)
				.then(function(filtered) {
					// It will always be a length of 1
					if (filtered.length === 1) {
						once = true;
						console.log('Filter match: ', filter);
					}
				})
			});
		})
	})
	.then(function() {
		conn.close();
	})
});

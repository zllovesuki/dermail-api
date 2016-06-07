var Promise = require('bluebird');

var self = module.exports = {
	getDKIMGivenAccountId: Promise.method(function(r, userId, accountId) {
		return r
		.table('accounts', {readMode: 'majority'})
		.getAll([userId, accountId], {index: 'userAccountMapping'})
		.eqJoin('domainId', r.table('domains', {readMode: 'majority'}))
		.zip()
		.pluck('dkim', 'domain')
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
	})
}

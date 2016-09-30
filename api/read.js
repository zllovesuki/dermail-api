var express = require('express'),
	router = express.Router(),
	helper = require('../lib/helper'),
	crypto = require('crypto'),
	Exception = require('../lib/error');

var auth = helper.auth.middleware;

router.get('/ping', auth, function(req, res, next) {
	return res.status(200).send('pong');
});

router.get('/security', auth, function(req, res, next) {

	var config = req.config;
	var r = req.r;

	var userId = req.user.userId;

	return r
	.table('accounts', {readMode: 'majority'})
	.getAll(userId, {index: 'userId'})
	.eqJoin('domainId', r.table('domains', {readMode: 'majority'}))
	.zip()
	.pluck('domainId')
	.concatMap(function(doc) {
		return doc.merge(function() {
			return [r.table('domains').get(doc('domainId'))]
		})
	})
	.map(function(doc) {
		return {
			domainId: doc('domainId'),
			domain: doc('domain'),
			isAdmin: doc('domainAdmin').eq(userId),
			dkim: r.branch(doc.hasFields('dkim'), doc('dkim').without('privateKey'), false)
		}
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(results) {
		return res.status(200).send({
			spf: config.domainName,
			dkim: results
		});
	})
    .error(function(e) {
		return next(e);
	})
})

router.get('/s3', auth, function(req, res, next) {

	var config = req.config;

	return res.status(200).send({
		endpoint: config.s3.endpoint,
		bucket: config.s3.bucket
	});
});

router.get('/getAccounts', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;

	return r
	.table('accounts', {readMode: 'majority'})
	.getAll(userId, {index: 'userId'})
	.eqJoin('domainId', r.table('domains', {readMode: 'majority'}))
	.zip()
	.map(function(doc) {
		return {
			accountId: doc('accountId'),
			domainId: doc('domainId'),
			domain: doc('domain'),
			account: doc('account'),
			alias: doc('alias'),
			notify: r.branch(doc.hasFields('notify'), doc('notify'), true)
		}
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(accounts) {
		return res.status(200).send(accounts);
	})
    .error(function(e) {
		return next(e);
	})
});

router.post('/getAccount', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;

	if (!accountId) {
		return next(new Exception.BadRequest('Account ID Required'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return helper.auth.userAccountMapping(r, userId, accountId)
	.then(function(account) {
		return res.status(200).send(account);
	})
	.catch(function(e) {
		return next(e);
	})
});

router.post('/getFoldersInAccount', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;

	if (!accountId) {
		return next(new Exception.BadRequest('Account ID Required'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return r
	.table('folders', {readMode: 'majority'})
	.getAll(accountId, {index: 'accountId'})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(folders) {
		if (folders.length === 0) {
			// WTF? IT SHOULD HAVE FUCKING FOLDERS
			return next(new Exception.NotFound('No folders found'));
		}
		res.status(200).send(folders);
	})
    .error(function(e) {
		return next(e);
	})
});

router.post('/getUnreadCountInAccount', auth, function(req, res, next) {

    var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;

	if (!accountId) {
		return next(new Exception.BadRequest('Account ID Required'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

    return r
    .table('folders', {readMode: 'majority'})
    .getAll(accountId, {index: 'accountId'})
    .pluck('folderId')
    .map(function(doc) {
        return {
            folderId: doc('folderId'),
            count: r.db('dermail').table('messages', {readMode: 'majority'}).getAll([doc('folderId'), false], {index: "unreadCount"}).count()
        }
    })
    .run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(result) {
        var counts = {};
        for (var i = 0, length = result.length; i < length; i++) {
            counts[result[i].folderId] = result[i].count;
        }
		res.status(200).send(counts);
	})
    .error(function(e) {
		return next(e);
	})
});

router.post('/getFolder', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var folderId = req.body.folderId;

	if (!folderId) {
		return next(new Exception.BadRequest('Folder ID Required.'));
	}

	if (!accountId) {
		return next(new Exception.BadRequest('Account ID Required'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return helper.auth.accountFolderMapping(r, accountId, folderId)
	.then(function(folder) {
		return res.status(200).send(folder);
	})
	.catch(function(e) {
		return next(e);
	})

});

router.post('/getMailsInFolder', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var folderId = req.body.folderId;
	var slice = (typeof req.body.slice === 'object' ? req.body.slice : {} );
	var lastDate = slice.date || r.maxval;
	var start = 0;
	var end = slice.perPage || 5;
	end = parseInt(end);
	var starOnly = !!slice.starOnly;

	if (!folderId) {
		return next(new Exception.Unauthorized('Folder ID Required.'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return helper.auth.accountFolderMapping(r, accountId, folderId)
	.then(function(folder) {
		return r
		.table('messages', {readMode: 'majority'})
		.between([folderId, r.minval], [folderId, lastDate], {index: 'folderDate'})
		.orderBy({index: r.desc('folderDate')})
	})
	.then(function(p) {
		if (starOnly) {
			return p.filter(function(doc) {
				return doc('isStar').eq(true)
			})
		}else{
			return p
		}
	})
	.then(function(p) {
		p
		.slice(start, end)
		.pluck('messageId', '_messageId', 'date', 'to', 'from', 'folderId', 'accountId', 'subject', 'text', 'isRead', 'isStar', 'authentication_results', 'dkim', 'spf')
		// Save some bandwidth and processsing
		.map(function(doc) {
			return doc.merge(function() {
				return {
					'to': doc('to').concatMap(function(to) { // It's like a subquery
						return [r.table('addresses', {readMode: 'majority'}).get(to).without('accountId', 'addressId', 'internalOwner')]
					}),
					'from': doc('from').concatMap(function(from) { // It's like a subquery
						return [r.table('addresses', {readMode: 'majority'}).get(from).without('accountId', 'addressId', 'internalOwner')]
					}),
					'text': doc('text').slice(0, 100)
				}
			})
		})
		.run(r.conn)
		.then(function(cursor) {
			return cursor.toArray();
		})
		.then(function(messages) {
			return res.status(200).send(messages);
		})
		.error(function(e) {
			req.log.error(e);
			return res.status(200).send([]);
		})
	})
	.catch(function(e) {
		return next(e);
	})
});

router.post('/getMail', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var messageId = req.body.messageId;

	if (!messageId) {
		return next(new Exception.Unauthorized('Message ID Required.'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return helper.auth.messageAccountMapping(r, messageId, accountId)
	.then(function() {
		return r
		.table('messages', {readMode: 'majority'})
		.get(messageId)
		.pluck('messageId', '_messageId', 'headers', 'date', 'to', 'from', 'cc', 'bcc', 'replyTo', 'folderId', 'accountId', 'subject', 'html', 'attachments', 'isRead', 'isStar', 'references', 'authentication_results', 'dkim', 'spf')
		// Save some bandwidth and processsing
		.merge(function(doc) {
			return {
				bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), [])
			}
		})
		.merge(function(doc) {
			return {
				'to': doc('to').concatMap(function(to) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(to).without('accountId', 'addressId', 'internalOwner')]
				}),
				'from': doc('from').concatMap(function(from) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(from).without('accountId', 'addressId', 'internalOwner')]
				}),
				'cc': doc('cc').concatMap(function(cc) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(cc).without('accountId', 'addressId', 'internalOwner')]
				}),
				'bcc': doc('bcc').concatMap(function(bcc) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(bcc).without('accountId', 'addressId', 'internalOwner')]
				}),
				'headers': r.table('messageHeaders', {readMode: 'majority'}).get(doc('headers')).without('accountId'),
				'attachments': doc('attachments').concatMap(function(attachment) { // It's like a subquery
					return [r.table('attachments', {readMode: 'majority'}).get(attachment)]
				})
			}
		})
		.run(r.conn)
		.then(function(message) {
			return res.status(200).send(message);
		})
		.error(function(e) {
			return next(e);
		})
	})
	.catch(function(e) {
		return next(e);
	});

});

router.post('/searchMailsInAccount', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var searchString = req.body.searchString;

	if (!searchString) {
		return res.status(200).send([]); // Empty string gives empty result
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return res.status(200).send([]); // Early surrender: account does not belong to user
	}

	/* Ideally, .indexCreate('messageAccountMapping', [r.row('messageId'), r.row('accountId')])
	** can be used without adding another index "accountId". But the behavior was unexpected.
	*/

	return r
	.table('messages', {readMode: 'outdated'})
	.getAll(accountId, {index: 'accountId'})
	.filter(function(doc){
		return r.or(doc('text').match("(?i)" + searchString), doc('subject').match("(?i)" + searchString))
	})
	.map(function(doc) {
		return doc.merge(function() {
			return {
				'folder': r.table('folders', {readMode: 'majority'}).get(doc('folderId')).pluck('folderId', 'displayName')
			}
		})
	})
	.pluck('subject', 'messageId', '_messageId', 'folder')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(messages) {
		return res.status(200).send(messages);
	}).error(function(e) {
		return next(e);
	})
});

router.post('/getAddress', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var email = req.body.email;
	var accountId = req.body.accountId;
	var empty = {friendlyName: ''};

	if (req.user.accounts.indexOf(accountId) === -1) {
		return res.status(200).send(empty); // Early surrender: account does not belong to user
	}

	return helper.address.getAddress(r, email, accountId, empty)
	.then(function(result) {
		delete result.addressId;
		return res.status(200).send(result);
	})
	.catch(function(e) {
		return next(e);
	})
});

router.post('/getFilters', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;
	var empty = [];

	if (req.user.accounts.indexOf(accountId) === -1) {
		return res.status(200).send(empty); // Early surrender: account does not belong to user
	}

	return helper.filter.getFilters(r, accountId, true)
	.then(function(result) {
		return res.status(200).send(result);
	})
	.catch(function(e) {
		return next(e);
	})
});

router.post('/searchWithFilter', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;

	var criteria = req.body.criteria || null;

	if (criteria === null) {
		return next(new Exception.NotFound('No criteria was defined.'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return res.status(200).send([]); // Early surrender: account does not belong to user
	}

	return r
	.table('messages', {readMode: 'outdated'})
	.getAll(accountId, {index: 'accountId'})
	.map(function(doc) {
		return doc.merge(function() {
			return {
				'to': doc('to').concatMap(function(to) { // It's like a subquery
					return [r.table('addresses', {readMode: 'outdated'}).get(to).without('accountId', 'addressId', 'internalOwner')]
				}),
				'from': doc('from').concatMap(function(from) { // It's like a subquery
					return [r.table('addresses', {readMode: 'outdated'}).get(from).without('accountId', 'addressId', 'internalOwner')]
				}),
				'folder': r.table('folders', {readMode: 'outdated'}).get(doc('folderId')).pluck('folderId', 'displayName')
			}
		})
	})
	.pluck('from', 'to', 'subject', 'text', 'folder', 'messageId')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(result) {

		var arrayOfFrom = !!!criteria.from ? null : criteria.from.toLowerCase().replace(/\s+/g,'').split(',');
		var arrayOfTo = !!!criteria.to ? null : criteria.to.toLowerCase().replace(/\s+/g,'').split(',');
		var subject = !!!criteria.subject ? null : criteria.subject.toLowerCase().replace(/\s+/g,'').split(',');
		var contain = !!!criteria.contain ? null : criteria.contain.toLowerCase().replace(/\s+/g,'').split(',');
		var exclude = !!!criteria.exclude ? null : criteria.exclude.toLowerCase().replace(/\s+/g,'').split(',');

		return helper.filter.applyFilters(result, arrayOfFrom, arrayOfTo, subject, contain, exclude)
	})
	.then(function(filtered) {
		for (var i = 0, flen = filtered.length; i < flen; i++) {
			delete filtered[i].text;
			delete filtered[i].to;
			delete filtered[i].from;
		}
		return res.status(200).send(filtered);
	})
	.catch(function(e) {
		return next(e);
	})
});

router.post('/getAddresses', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;

	if (!accountId) {
		return next(new Exception.NotFound('Account ID Required.'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return r
	.table('addresses', { readMode: 'outdated' })
	.eqJoin('accountId', r.table('accounts', { readMode: 'majority' })).without({
		right: ['account', 'domainId', 'notify']
	})
	.zip()
	.filter(function(d) {
		return d('accountId').eq(accountId).and(r.not(d.hasFields('aliasOf'))).and(d('internalOwner').eq(null))
	})
	.map(function(c) {
		return c.merge(function(e) {
			return {
				hold: r.branch(e.hasFields('hold'), e('hold'), false)
			}
		})
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(results) {
		return res.status(200).send(results);
	})

});

router.post('/getMyOwnAddress', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var accountId = req.body.accountId;

	if (!accountId) {
		return next(new Exception.NotFound('Account ID Required.'));
	}

	if (req.user.accounts.indexOf(accountId) === -1) {
		return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	return r
	.table('addresses', { readMode: 'outdated' })
	.eqJoin('accountId', r.table('accounts', { readMode: 'majority' })).without({
		right: ['account', 'domainId', 'notify']
	})
	.zip()
	.filter(function(d) {
		return d('accountId').eq(accountId).and(r.not(d('internalOwner').eq(null)))
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(results) {
		return res.status(200).send(results);
	})

});

router.get('/getPayload', function(req, res, next) {

	var r = req.r;

	var hash = crypto.createHash('sha1').update(req.query.endpoint).digest("hex");

	return r
	.table('payload', {readMode: 'majority'})
	.get(hash)
	.run(r.conn)
	.then(function(result) {
		if (result !== null) {
			return snapchat(r, hash)
			.then(function() {
				return res.status(200).send(result.payload);
			})
		}else{
			return res.status(200).send({});
		}
	})
	.catch(function(e) {
		return res.status(200).send({});
	})
});

function snapchat(r, hash) {
	return r
	.table('payload', {readMode: 'majority'})
	.get(hash)
	.delete()
	.run(r.conn)
}

module.exports = router;

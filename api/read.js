var Promise = require('bluebird'),
    express = require('express'),
	router = express.Router(),
	helper = require('../lib/helper'),
    binarySearchInsert = require('binary-search-insert'),
	crypto = require('crypto'),
	Exception = require('../lib/error');

var auth = helper.auth.middleware;

router.get('/_ping', function(req, res, next) {
    var messageQ = req.Q;
    var job = messageQ.createJob({
        type: 'ping'
    }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
    return messageQ.addJob(job)
    .then(function() {
        res.status(200).send();
    })
})

router.get('/ping', auth, function(req, res, next) {
	return res.status(200).send('pong');
});

router.get('/security', auth, function(req, res, next) {

	var config = req.config;
	var r = req.r;

	var userId = req.user.userId;

	return r
	.table('accounts')
	.getAll(userId, {index: 'userId'})
	.eqJoin('domainId', r.table('domains'))
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
	.run(r.conn, {
        readMode: 'majority'
    })
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
        .table('accounts')
        .getAll(userId, {
            index: 'userId'
        })
        .eqJoin('domainId', r.table('domains'))
        .zip()
        .map(function(doc) {
            return {
                accountId: doc('accountId'),
                domainId: doc('domainId'),
                domain: doc('domain'),
                account: doc('account'),
                alias: doc('alias'),
                notify: r.branch(doc.hasFields('notify'), doc('notify'), true),
                bayesEnabled: r.branch(doc.hasFields('bayesEnabled'), doc('bayesEnabled'), false)
            }
        })
        .map(function(doc) {
            return r.branch(
                r.tableList().contains(doc('accountId').add('Store')),
                doc.merge(function() {
                    return {
                        trainLock: r.table(doc('accountId').add('Store')).get('trainLock')('value').default(false)
                    }
                }),
                doc
            );
        })
        .map(function(doc) {
            return r.branch(doc('bayesEnabled'),
                doc.merge(function() {
                    return {
                        lastTrainedMailWasSavedOn: r.table(doc('accountId').add('Store')).get('lastTrainedMailWasSavedOn')('value').default('0')
                    }
                }),
                doc
            );
        })
        .map(function(doc) {
            return r.branch(doc.hasFields('lastTrainedMailWasSavedOn'),
                doc.merge(function() {
                    return {
                        untrainMailsCount: r.table('messages')
                            .getAll(doc('accountId'), {
                                index: 'accountId'
                            })
                            .filter(function(f) {
                                return f('savedOn').gt(doc('lastTrainedMailWasSavedOn'))
                            })
                            .count()
                    }
                }),
                doc
            );
        })
        .run(r.conn, {
            readMode: 'majority'
        })
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

    if (accountId === 'unified') {
        return res.status(200).send({
            account: 'everything',
            domain: 'unified',
            accountId: 'unified'
        })
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
	.table('folders')
	.getAll(accountId, {index: 'accountId'})
	.run(r.conn, {
        readMode: 'majority'
    })
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
    .table('folders')
    .getAll(accountId, {index: 'accountId'})
    .pluck('folderId')
    .map(function(doc) {
        return {
            folderId: doc('folderId'),
            count: r.table('messages', {readMode: 'majority'}).getAll([doc('folderId'), false], {index: "unreadCount"}).count()
        }
    })
    .run(r.conn, {
        readMode: 'majority'
    })
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

    if (accountId === 'unified' && folderId === 'inbox') {
        return res.status(200).send({
            accountId: 'unified',
            description: 'Unified Inbox',
            displayName: 'Inbox',
            folderId: 'inbox',
            mutable: false,
            parent: null
        })
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

    var accountIds = [];
    var skipFolders = [
        'Spam',
        'Trash',
        'Sent'
    ]
    var starlight = [];

	var accountId = req.body.accountId;
	var folderId = req.body.folderId;
	var slice = (typeof req.body.slice === 'object' ? req.body.slice : {} );
    var context = slice.context || {};
	var start = 0;
	var end = slice.perPage || 5;
	end = parseInt(end);
	var starOnly = !!slice.starOnly;

    if (folderId !== 'inbox' && !folderId) {
        return next(new Exception.Unauthorized('Folder ID Required.'));
    }

    if (accountId !== 'unified' && req.user.accounts.indexOf(accountId) === -1) {
        return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
    }

    if (accountId !=='unified' || folderId !== 'inbox') {
        accountIds = [ accountId ]
    }else{
        accountIds = req.user.accounts
    }

    if (starOnly) {
        starlight.push(true)
    }else{
        starlight.push(true)
        starlight.push(false)
    }

    var sorted = [];

    return helper.folder.getFoldersFromAccounts(r, accountIds)
    .then(function(folders) {

        if (folders.length === 0) return;

        var folderMap = {}
        var accountMap = {}
        var complex = [];
        var includeFolderIds = []

        folders.forEach(function(folder) {
            if (typeof accountMap[folder.accountId] === 'undefined') {
                accountMap[folder.accountId] = [];
            }
            if (typeof context[folder.folderId] === 'undefined') {
                context[folder.folderId] = r.maxval
            }
            accountMap[folder.accountId].push(folder)
            folderMap[folder.folderId] = folder

            if (accountId !=='unified' || folderId !== 'inbox') {
                if (folder.folderId === folderId) {
                    includeFolderIds.push(folder.folderId)
                }
            }else{
                if (skipFolders.indexOf(folder.displayName) < 0) {
                    includeFolderIds.push(folder.folderId)
                }
            }
        })

        if (includeFolderIds.length === 0) return;

        for (var i = 0; i < includeFolderIds.length; i++) {
            complex.push({
                left: [
                    includeFolderIds[i],
                    r.minval
                ],
                right: [
                    includeFolderIds[i],
                    context[includeFolderIds[i]]
                ]
            })
        }

        var arrayOfPromises = [];
        for (var i = 0; i < complex.length; i++) {
            arrayOfPromises.push(r.table('messages')
            .between(r.expr(complex[i].left), r.expr(complex[i].right), { index: 'folderSavedOn' })
            .orderBy({ index: r.desc('folderSavedOn') })
            .filter(function(doc) {
                return r.expr(starlight).contains(doc('isStar'))
            })
            .pluck('messageId', '_messageId', 'folderId', 'date', 'savedOn', 'to', 'from', 'accountId', 'subject', 'text', 'isRead', 'isStar')
            .slice(start, end)
            .run(r.conn)
            .then(function(cursor) {
                var errorHandler = function(err) {
                    if (((err.name === "ReqlDriverError") && err.message === "No more rows in the cursor.")) {
                        return;
                    }else{
                        throw err;
                    }
                }
                var fetchNext = function(message) {
                    message.displayName = folderMap[message.folderId].displayName
                    message.accountFlatFolders = accountMap[message.accountId]
                    message.text = message.text.slice(0, 100)
                    binarySearchInsert(sorted, function(a, b) {
                        if (b.savedOn < a.savedOn) return -1;
                        else if (b.savedOn > a.savedOn) return 1;
                        else return 0
                    }, message)
                    cursor.next().then(fetchNext).error(errorHandler);
                }
                cursor.next().then(fetchNext).error(errorHandler);
            }))
        }

        return Promise.all(arrayOfPromises)
    })
    .then(function() {
        return res.status(200).send(sorted.slice(start, end))
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
		.table('messages')
		.get(messageId)
        .merge(function(doc) {
            return {
                displayName: r.table('folders').get(doc('folderId'))('displayName'),
                accountFlatFolders: r.table('folders').getAll(doc('accountId'), { index: 'accountId' }).coerceTo('array')
            }
        })
		.pluck('messageId', '_messageId', 'accountFlatFolders', 'displayName', 'folderId', 'headers', 'date', 'to', 'from', 'cc', 'bcc', 'replyTo', 'accountId', 'subject', 'html', 'attachments', 'isRead', 'isStar', 'references', 'authentication_results', 'dkim', 'spf')
        .merge(function(doc) {
            return {
                cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
                bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), [])
            }
        })
		.run(r.conn, {
            readMode: 'majority'
        })
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

	if (accountId !== 'unified' && req.user.accounts.indexOf(accountId) === -1) {
		return res.status(200).send([]); // Early surrender: account does not belong to user
	}

    var searchObj = {
        q: searchString,
        index: [userId, '*'].join('_').toLowerCase(),
        type: 'messages',
        _source: false
    }

    if (accountId !== 'unified') searchObj.index = [userId, accountId].join('_').toLowerCase(),

    req.elasticsearch.search(searchObj, function(error, response) {
        if (error) {
            return next(error);
        }
        var ids = response.hits.hits.map(function(doc) {
            return doc._id;
        })
        r.table('messages')
        .getAll(r.args(ids))
        .map(function(doc) {
    		return doc.merge(function() {
    			return {
    				'folder': r.table('folders').get(doc('folderId')).pluck('folderId', 'displayName'),
                    'account': r.table('accounts').get(doc('accountId')).merge(function(acc) {
                        return r.table('domains').get(acc('domainId')).pluck('domain')
                    }).pluck('accountId', 'account', 'domain')
    			}
    		})
    	})
        .pluck('subject', 'messageId', '_messageId', 'folder', 'account')
    	.run(r.conn)
    	.then(function(cursor) {
    		return cursor.toArray();
    	})
    	.then(function(messages) {
    		return res.status(200).send(messages);
    	})
        .error(function(e) {
    		return next(e);
    	})
    })
});

router.post('/getAddress', auth, function(req, res, next) {

	var r = req.r;

	var userId = req.user.userId;
	var query = req.body.query || '';
	var accountId = req.body.accountId;
	var empty = [{name: '', address: query}];

	if (req.user.accounts.indexOf(accountId) === -1 || query.length < 3) {
		return res.status(200).send(empty); // Early surrender: account does not belong to user
	}

	return r.table('messages')
    .getAll(accountId, {
        index: 'accountId'
    })
    .eqJoin('folderId', r.table('folders'))
    .zip()
    .filter(function(doc) {
        return r.not(r.expr(['Spam']).contains(doc('displayName')))
    })
    .concatMap(function(row) {
        return r.expr(['to', 'from', 'cc', 'bcc']).fold([], function(acc, type) {
            return acc.add(r.branch(row.hasFields(type), row(type), []))
        })
    })
    .map(function(obj) {
        return obj.merge(function() {
            return {
                address: r.branch(obj.hasFields('address'), obj('address').downcase(), '')
            }
        })
    })
    .distinct()
    .filter(function(doc) {
        return doc('address').match(r.add('(?i)', query)).or(doc('name').match(r.add('(?i)', query)))
    })
    .run(r.conn)
    .then(function(cursor) {
        return cursor.toArray();
    })
    .then(function(results) {
        if (results.length === 0) {
            return res.status(200).send(empty)
        }
		return res.status(200).send(results);
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

    return r.table('accounts').getAll([userId, accountId], {
        index: 'userAccountMapping'
    })
    .concatMap(function(z) {
        return r.branch(z.hasFields('addresses'), z('addresses'), [])
    })
    .run(r.conn)
    .then(function(cursor) {
        return cursor.toArray();
    })
    .then(function(addresses) {
    	return res.status(200).send(addresses);
    })
    .catch(function(e) {
		return next(e);
	})
});

module.exports = router;

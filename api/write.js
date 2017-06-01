var reservedFolderNames = [
    'inbox',
    'trash',
    'sent',
    'spam'
];
var noChildrenAllowed = [
    'trash',
    'sent'
];
var allowTruncate = [
    'trash',
    'spam',
    'sent'
];
var invalidFolderDestination = [
    'spam',
    'trash',
    'sent'
];
var express = require('express'),
    router = express.Router(),
    passport = require('passport'),
    Promise = require('bluebird'),
    helper = require('../lib/helper'),
    shortid = require('shortid'),
    dns = Promise.promisifyAll(require('dns')),
    crypto = require('crypto'),
    forge = require('node-forge'),
    rsa = forge.pki.rsa,
    Exception = require('../lib/error');

shortid.worker(process.pid % 16);

var auth = helper.auth.middleware;

router.post('/updateMail', auth, function(req, res, next) {

    var r = req.r;
    var config = req.config;
    var messageQ = req.Q;

    var userId = req.user.userId;
    var accountId = req.body.accountId || '';
    var messageId = req.body.messageId || '';
    var action = req.body.action || '';
    var data = {};

    if (!messageId) {
        return next(new Exception.BadRequest('Message ID Required.'));
    }

    if (req.user.accounts.indexOf(accountId) === -1) {
        return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
    }

    switch (action.toLowerCase()) {
        case 'star':
            data.isStar = true;
            break;
        case 'unstar':
            data.isStar = false;
            break;
        case 'read':
            data.isRead = true;
            break;
        case 'unread':
            data.isRead = false;
            break;
        case 'folder':
            var folderId = req.body.folderId;
            if (!folderId) {
                return next(new Exception.BadRequest('Folder ID Required'));
            }
            return helper.auth.accountFolderMapping(r, accountId, folderId)
            .then(function(folder) {
                if (invalidFolderDestination.indexOf(folder.displayName.toLowerCase().trim()) > 0) {
                    return next(new Exception.BadRequest('You cannot move message to "' + folder.displayName + '" from this operation.'));
                }
                data.folderId = folderId;
                return doUpdateMail(r, messageId, accountId, data)
            })
            .then(function(result) {
                res.status(200).send(result);
            })
            .catch(function(e) {
                return next(e);
            })

            break;
        case 'trash':
            return Promise.all([
                helper.folder.getInternalFolder(r, accountId, 'Trash'),
                helper.folder.getMessageFolder(r, messageId)
            ]).spread(function(trashFolder, sourceFolder) {
                data.folderId = trashFolder;
                return doUpdateMail(r, messageId, accountId, data)
                .then(function(result) {
                    var checkSource = function() {
                        var sourceName = sourceFolder.displayName.toLowerCase().trim();
                        switch (sourceName) {
                            case 'spam':
                            // assume to be not spam for now
                            var job = messageQ.createJob({
                                type: 'modifyBayes',
                                payload: {
                                    changeTo: 'Ham',
                                    userId: userId,
                                    messages: [messageId]
                                }
                            }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
                            return messageQ.addJob(job)
                            break;

                            default:
                            // everything else is already trained
                            return Promise.resolve()
                            break;
                        }
                    }
                    return checkSource().then(function() {
                        res.status(200).send(result);
                    })
                })
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        case 'spam':
            return helper.folder.getInternalFolder(r, accountId, 'Spam')
            .then(function(spamFolder) {
                data.folderId = spamFolder;
                return doUpdateMail(r, messageId, accountId, data)
            })
            .then(function(result) {
                var job = messageQ.createJob({
                    type: 'modifyBayes',
                    payload: {
                        changeTo: 'Spam',
                        userId: userId,
                        messages: [messageId]
                    }
                }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
                return messageQ.addJob(job)
                .then(function() {
                    res.status(200).send(result);
                })
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        case 'notspam':
            return helper.folder.getInternalFolder(r, accountId, 'Inbox')
            .then(function(inboxFolder) {
                data.folderId = inboxFolder;
                return doUpdateMail(r, messageId, accountId, data)
                .then(function(result) {
                    var job = messageQ.createJob({
                        type: 'modifyBayes',
                        payload: {
                            changeTo: 'Ham',
                            userId: userId,
                            messages: [messageId]
                        }
                    }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
                    return messageQ.addJob(job)
                })
                .then(function() {
                    res.status(200).send(inboxFolder);
                })
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        case 'delete':
            return Promise.all([
                helper.auth.messageAccountMapping(r, messageId, accountId),
                helper.folder.getInternalFolder(r, accountId, 'Trash')
            ]).spread(function(message, trashFolder) {
                if (message.folderId !== trashFolder) {
                    return next(new Exception.Forbidden('Message must be in the Trash folder first to be deleted permanently.'))
                }
                // untrain deleted mails
                var job = messageQ.createJob({
                    type: 'deleteMessagesPermanently',
                    payload: {
                        changeFrom: 'Trash', // only from trash
                        changeTo: 'Undo',
                        userId: userId,
                        messages: [message]
                    }
                }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
                return messageQ.addJob(job);
            })
            .then(function() {
                res.status(200).send({})
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        default:
            return next(new Error('Not implemented.'));
            break;
    }

    return doUpdateMail(r, messageId, accountId, data)
    .then(function(result) {
        res.status(200).send(result);
    })
    .catch(function(e) {
        return next(e);
    })
});

router.post('/trainBayes', auth, function(req, res, next) {

    var messageQ = req.Q;
    var config = req.config;

    var userId = req.user.userId;

    var job = messageQ.createJob({
        type: 'trainBayes',
        payload: {
            userId: userId
        }
    }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
    return messageQ.addJob(job)
    .then(function() {
        res.status(200).send();
    })

})

router.post('/updateFolder', auth, function(req, res, next) {

    var r = req.r;
    var messageQ = req.Q;
    var config = req.config;

    var userId = req.user.userId;
    var accountId = req.body.accountId;
    var parent = (req.body.parent === '/root' ? null : req.body.parent);
    var action = req.body.action;
    var data = {};
    data.displayName = req.body.displayName || '';
    data.description = req.body.description || '';
    data.parent = parent;
    data.mutable = true;

    if (req.user.accounts.indexOf(accountId) === -1) {
        return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
    }

    if (action !== 'truncateFolder' && reservedFolderNames.indexOf(data.displayName.toLowerCase().trim()) !== -1) { // Some display names are reserved
        return next(new Exception.BadRequest('Cannot use reserved folder names.'));
    }

    if (data.displayName === '' || data.description === '') {
        return next(new Exception.BadRequest('Name and description cannot be empty.'));
    }

    switch (action) {
        case 'truncateFolder':
            var folderId = req.body.folderId;
            return helper.auth.accountFolderMapping(r, accountId, folderId)
            .then(function(folder) {
                if (allowTruncate.indexOf(folder.displayName.toLowerCase().trim()) === -1) {
                    throw new Exception.BadRequest('Only "SPAM", "Trash", and "Sent" folders can be truncated.');
                }
                return r
                .table('messages', {readMode: 'majority'})
                .between([folderId, r.minval], [folderId, r.maxval], {index: 'folderSaved'})
                .pluck('messageId', 'attachments')
                .run(r.conn)
                .then(function(cursor) {
                    return cursor.toArray();
                })
                .then(function(messages) {
                    var job = messageQ.createJob({
                        type: 'deleteMessagesPermanently',
                        payload: {
                            userId: userId,
                            changeFrom: folder.displayName,
                            messages: messages
                        }
                    }).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
                    return messageQ.addJob(job);
                })
            })
            .then(function() {
                return res.status(200).send({});
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        case 'deleteFolder':
            var folderId = req.body.folderId;

            return helper.auth.accountFolderMapping(r, accountId, folderId)
            .then(function() {
                return r
                .table('folders', {readMode: 'majority'})
                .getAll(accountId, {index: 'accountId'})
                .filter({
                    parent: folderId
                })
                .count()
                .run(r.conn)
            })
            .then(function(childrenCount) {
                if (childrenCount !== 0) {
                    throw new Exception.BadRequest('Folder contains children.');
                }
                return helper.folder.getInternalFolder(r, accountId, 'Trash')
            })
            .then(function(trashFolder) {
                return batchMoveToTrashAndRemoveFolder(r, folderId, trashFolder)
            })
            .then(function(result) {
                return res.status(200).send({});
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        case 'updateFolder':
            var folderId = req.body.folderId;
            if (!folderId) {
                return next(new Exception.BadRequest('Folder ID Required'));
            }

            return helper.auth.accountFolderMapping(r, accountId, folderId)
            .then(function(folder) {
                // Sanity check
                if (folder.mutable === false) {
                    throw new Exception.BadRequest('Folder not mutable.');
                }
                if (parent === null) {
                    return doUpdateFolder(r, folderId, data)
                }else{
                    return helper.auth.accountFolderMapping(r, accountId, parent)
                    .then(parentTest)
                    .then(function() {
                        return doUpdateFolder(r, folderId, data)
                    })
                }
            })
            .then(function(result) {
                return res.status(200).send({});
            })
            .catch(function(e) {
                return next(e);
            })
            break;
        case 'addFolder':
            data.accountId = accountId;
            if (data.parent === null) {
                return doAddFolder(r, data)
                .then(function(result) {
                    res.status(200).send(result);
                })
                .catch(function(e) {
                    return next(e);
                })
            }else{
                return helper.auth.accountFolderMapping(r, accountId, data.parent)
                .then(parentTest)
                .then(function() {
                    return doAddFolder(r, data)
                })
                .then(function(result) {
                    res.status(200).send({});
                })
                .catch(function(e) {
                    return next(e);
                })
            }
            break;
        default:
            return next(new Error('Not implemented.'));
            break;
    }

});

router.post('/pushSubscriptions', auth, function(req, res, next) {

    var r = req.r;
    var config = req.config;

    var userId = req.user.userId;
    var action = req.body.action;
    var payload = req.body.payload;

    var object = JSON.parse(payload);

    switch (action) {
        case 'subscribe':
        return r
        .table('pushSubscriptions', {readMode: 'majority'})
        .get(userId)
        .run(r.conn)
        .then(function(result) {
            if (result === null) {
                return r
                .table('pushSubscriptions')
                .insert({
                    userId: userId,
                    subscriptions: [object]
                })
                .run(r.conn)
                .then(function(result) {
                    return res.status(200).send();
                })
            }else{
                return r
                .table('pushSubscriptions', {readMode: 'majority'})
                .get(userId)
                .update({
                    subscriptions: r.row('subscriptions').append(object)
                })
                .run(r.conn)
                .then(function(result) {
                    return res.status(200).send();
                })
            }
        })
        break;
        case 'unsubscribe':
        return r
        .table('pushSubscriptions', {readMode: 'majority'})
        .get(userId)
        .run(r.conn)
        .then(function(result) {
            if (result === null) {
                return res.status(500).send({message: 'No subscription found.'})
            }else{
                return r
                .table('pushSubscriptions', {readMode: 'majority'})
                .get(userId)
                .getField('subscriptions')
                .run(r.conn)
                .then(function(result) {
                    result = result.filter(function(f) {
                        return f['endpoint'] !== object.endpoint;
                    })
                    return r.table('pushSubscriptions', {readMode: 'majority'})
                    .get(userId)
                    .update({
                        subscriptions: result
                    })
                    .run(r.conn)
                    .then(function(result) {
                        return res.status(200).send();
                    })
                })
            }
        })
        break;
        case 'test':
        return helper.notification.sendNotification(r, config.gcm_api_key, {
            header: 'Test',
            body: 'This is a test!',
            accountId: null
        }, object).then(function() {
            return res.status(200).send();
        })
        break;
        case 'disableNotify':
        case 'enableNotify':
        var accountId = object.accountId;
        if (req.user.accounts.indexOf(accountId) === -1) {
            return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
        }
        return r
        .table('accounts', {readMode: 'majority'})
        .get(accountId)
        .update({
            notify: action === 'enableNotify'
        })
        .run(r.conn)
        .then(function() {
            return res.status(200).send();
        })
        break;
        default:
        return next(new Error('Not implemented.')); // Early surrender: account does not belong to user
        break;
    }
});

router.post('/modifyFilter', auth, function(req, res, next) {

    var r = req.r;

    var userId = req.user.userId;
    var accountId = req.body.accountId;
    var filterId = req.body.filterId;

    var op = req.body.op;

    if (req.user.accounts.indexOf(accountId) === -1) {
        return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
    }

    switch (op) {
        case 'add':
            var criteria = req.body.criteria;
            var action = req.body.action;
            var existing = req.body.existing;

            var arrayOfFrom = !!!criteria.from ? null : criteria.from.toLowerCase().replace(/\s+/g,'').split(',');
            var arrayOfTo = !!!criteria.to ? null : criteria.to.toLowerCase().replace(/\s+/g,'').split(',');
            var subject = !!!criteria.subject ? null : criteria.subject.toLowerCase().replace(/\s+/g,'').split(',');
            var contain = !!!criteria.contain ? null : criteria.contain.toLowerCase().replace(/\s+/g,'').split(',');
            var exclude = !!!criteria.exclude ? null : criteria.exclude.toLowerCase().replace(/\s+/g,'').split(',');

            var folderId = action.folder;

            var doAddFilter = function() {
                var id = shortid.generate();
                return r // First we add the filter
                .table('filters')
                .insert({
                    filterId: id,
                    accountId: accountId,
                    pre: {
                        from: arrayOfFrom,
                        to: arrayOfTo,
                        subject: subject,
                        contain: contain,
                        exclude: exclude
                    },
                    post: action
                })
                .run(r.conn)
                .then(function() {
                    return r // Then we searchWithFilter()
                    .table('messages', {readMode: 'majority'})
                    .getAll(accountId, {index: 'accountId'})
                    .pluck('from', 'to', 'subject', 'text', 'messageId', 'accountId')
                    .run(r.conn)
                    .then(function(cursor) {
                        return cursor.toArray();
                    })
                })
                .then(function(result) {
                    return helper.filter.applyFilters(result, arrayOfFrom, arrayOfTo, subject, contain, exclude)
                })
                .then(function(filtered) {
                    return Promise.map(filtered, function(message) {
                        return Promise.map(Object.keys(action), function(key) {
                            if (!!existing[key]) {
                                return helper.filter.applyAction(r, key, action[key], message);
                            }
                        })
                    })
                })
                .then(function() {
                    return res.status(200).send();
                })
                .catch(function(e) {
                    return next(e);
                })
            };

            if (folderId !== 'default') {
                // Never trust the user
                return helper.auth.accountFolderMapping(r, accountId, folderId)
                .then(function() {
                    return doAddFilter();
                })
                .catch(function(e) {
                    return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
                })
            }else{
                return helper.folder.getInternalFolder(r, accountId, 'Inbox')
                .then(function(inboxId) {
                    action.folder = inboxId;
                    return doAddFilter();
                })
                .catch(function(e) {
                    return next(e);
                })
            }
            break;
        case 'delete':
            return r
            .table('filters', {readMode: 'majority'})
            .get(filterId)
            .run(r.conn)
            .then(function(filter) {
                if (filter === null) {
                    return next(new Exception.NotFound('Filter does not exist.'));
                }
                if (filter.accountId !== accountId) {
                    return next(new Exception.Forbidden('Unspeakable horror.')); // Early surrender: account does not belong to user
                }
                return r
                .table('filters', {readMode: 'majority'})
                .get(filterId)
                .delete()
                .run(r.conn)
                .then(function() {
                    return res.status(200).send();
                })
            })
            .catch(function(e) {
                return next(e);
            });
            break;
        default:
        return next(new Error('Not implemented.'));
        break;
    }
})

router.post('/updateDomain', auth, function(req, res, next) {

    var r = req.r;

    var userId = req.user.userId;
    var action = req.body.action;
    var domainId

    if (action === 'newDomain') {
        domainId = 'of course it does not exist';
    }else{
        domainId = req.body.domainId;
    }

    if (!!!domainId) {
        return next(new Exception.BadRequest('Domain ID Required'));
    }

    return r
    .table('domains', {readMode: 'majority'})
    .get(domainId)
    .run(r.conn)
    .then(function(domain) {
        if (action == 'newDomain') {
            domain = req.body.domain;
            if (!!!domain) {
                return next(new Exception.BadRequest('Domain Required'));
            }
            return domain;
        }
        if (domain === null) {
            throw new Exception.NotFound('Domain does not exist.');
        }
        if (domain.domainAdmin !== userId) {
            throw new Exception.Forbidden('Only the domain admin can modify the domain.');
        }
        return domain;
    })
    .then(function(domain) {
        switch (action) {
            case 'updateAlias':

            var alias = req.body.alias;

            // remove whitespace only element, and remove non-fqdn domains
            alias = alias.filter(function(str) {
                return /\S/.test(str) && /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(str);
            });

            // Now we are going to do a very inefficient operation: creating an alias for each domain mapping to an account
            // Then if the aliases no longer have dependencies, we will remove the alias

            var listOfAccounts = [];
            var customizeEmptyResponse = 'everything is awesome';

            // First, get all accounts under the domain
            return r
            .table('accounts', {readMode: 'majority'})
            .getAll(userId, { index: 'userId' })
            .filter(function(doc) {
                return doc('domainId').eq(domainId)
            })
            .map(function(doc) {
                return doc.merge(function() {
                    return {
                        domain: r.table('domains', {readMode: 'majority'}).get(doc('domainId'))('domain')
                    }
                })
            })
            .run(r.conn)
            .then(function(cursor) {
                return cursor.toArray();
            })
            .then(function(accounts) {
                return Promise.map(accounts, function(account) {
                    var addresses = [];
                    addresses.push({
                        name: req.user.firstName + ' ' + req.user.lastName,
                        address: [account.account, account.domain].join('@'),
                        isAlias: false
                    })
                    alias.forEach(function(domain) {
                        addresses.push({
                            name: req.user.firstName + ' ' + req.user.lastName,
                            address: [account.account, domain].join('@'),
                            isAlias: true
                        })
                    })
                    return r.table('accounts')
                    .get(account.accountId)
                    .update({
                        addresses: addresses
                    })
                    .run(r.conn)
                })
            })
            .then(function() {
                return r
                .table('domains', {readMode: 'majority'})
                .get(domainId)
                .update({
                    alias: alias
                })
                .run(r.conn)
            })
            .then(function() {
                return res.status(200).send({});
            })

            break;

            case 'generateKeyPair':

            if (typeof domain.dkim === 'object') {
                throw new Exception.BadRequest('Please delete the old keypair before generating a new pair.');
            }

            var keyPair = rsa.generateKeyPair({bits: 2048, e: 0x10001});

            var pemPublic = forge.pki.publicKeyToPem(keyPair.publicKey);
            var pemPrivate = forge.pki.privateKeyToPem(keyPair.privateKey);

            var pubLines = pemPublic.split("\r\n");
            pubLines = pubLines.filter(function(line) {
                return (line.length > 0) && (line.substring(0, 5) != '-----');
            });
            var publicKey = pubLines.join("");

            var privLines = pemPrivate.split("\r\n");
            privLines = privLines.filter(function(line) {
                return (line.length > 0) && (line.substring(0, 5) != '-----');
            });
            var privateKey = privLines.join("");

            var selector = Math.floor(new Date() / 1000) + '.dermail';

            return r
            .table('domains', {readMode: 'majority'})
            .get(domainId)
            .update({
                dkim: {
                    selector: selector,
                    publicKey: publicKey,
                    privateKey: privateKey
                }
            })
            .run(r.conn)
            .then(function() {
                return res.status(200).send({});
            })

            break;

            case 'verifyKeyPair':

            if (typeof domain.dkim !== 'object') {
                throw new Exception.BadRequest('No keypair found.');
            }

            var query = [domain.dkim.selector, '_domainkey', domain.domain].join('.');

            return dns.resolveTxtAsync(query)
            .then(function(result) {
                if (!result || !result.length) {
                    throw new Exception.NotFound('Selector not found (%s)', query);
                }
                var data = {};
                [].concat(result[0] || []).join('').split(/;/).forEach(function(row) {
                    var key, val;
                    row = row.split('=');
                    key = (row.shift() || '').toString().trim();
                    val = (row.join('=') || '').toString().trim();
                    data[key] = val;
                });

                if (!data.p) {
                    throw new Exception.NotFound('DNS TXT record does not seem to be a DKIM value', query);
                }

                var pubKey = '-----BEGIN PUBLIC KEY-----\r\n' + data.p.replace(/.{78}/g, '$&\r\n') + '\r\n-----END PUBLIC KEY-----';
                var privKey = '-----BEGIN RSA PRIVATE KEY-----\r\n' + domain.dkim.privateKey.replace(/.{78}/g, '$&\r\n') + '\r\n-----END RSA PRIVATE KEY-----';

                var sign = crypto.createSign('RSA-SHA256');
                sign.update('dermail');
                var signature = sign.sign(privKey, 'hex');
                var verifier = crypto.createVerify('RSA-SHA256');
                verifier.update('dermail');

                if (verifier.verify(pubKey, signature, 'hex')) {
                    return res.status(200).send({});
                }else{
                    throw new Exception.BadRequest('Verification failed: keys not match');
                }
            })
            .catch(function(e) {
                switch (e.code) {
                    case dns.NOTFOUND:
                    case dns.NODATA:
                    case dns.NXDOMAIN:
                        throw new Exception.NotFound('No key was found.');
                        break;
                    default:
                        throw new Error('DNS lookup error.');
                        break;
                }
            });

            break;

            case 'deleteKeyPair':

            return r
            .table('domains', {readMode: 'majority'})
            .get(domainId)
            .replace(r.row.without('dkim'))
            .run(r.conn)
            .then(function() {
                return res.status(200).send({});
            })

            break;

            case 'newDomain':

            return r
            .table('domains', {readMode: 'majority'})
            .getAll(domain, {index: 'domain'})
            .count()
            .run(r.conn)
            .then(function(count) {
                if (count > 0) {
                    throw new Exception.BadRequest('Domain already existed.')
                }
            })
            .then(function() {
                var newDomainId = shortid.generate();
                return r
                .table('domains')
                .insert({
                    domainId: newDomainId,
                    alias: [],
                    domainAdmin: userId,
                    domain: domain
                })
                .run(r.conn)
                .then(function() {
                    return res.status(200).send(newDomainId);
                })
            })

            break;

            default:
            throw new Error('Not implemented.');
            break;
        }
    })
    .catch(function(e) {
        return next(e);
    });

});

router.post('/updateAccount', auth, function(req, res, next) {

    var r = req.r;

    var userId = req.user.userId;

    var action = req.body.action;

    switch (action) {
        case 'newAccount':

        var domainId = req.body.domainId;

        if (!!!domainId) {
            return next(new Exception.BadRequest('Domain ID Required'));
        }

        return r
        .table('domains', {readMode: 'majority'})
        .get(domainId)
        .run(r.conn)
        .then(function(domain) {
            if (domain === null) {
                throw new Exception.NotFound('Domain does not exist.');
            }
            if (domain.domainAdmin !== userId) {
                throw new Exception.Forbidden('Only the domain admin can modify the domain.');
            }
            return domain;
        })
        .then(function(domain) {
            var account = req.body.account || '';
            if (account.length < 1) {
                return next(new Exception.BadRequest('Account Required'));
            }
            return r
            .table('accounts', {readMode: 'majority'})
            .getAll([account, domainId], {index: 'accountDomainId'})
            .count()
            .run(r.conn)
            .then(function(existingAccount) {
                if (existingAccount > 0) {
                    return next(new Exception.BadRequest('Account already existed.'));
                }
            })
            .then(function() {
                // steps here are basically from usefulScripts/firstUser.js
                var accountId = shortid.generate();
                var folderId = shortid.generate();

                return r
                .table('accounts')
                .insert({
                    accountId: accountId,
                    userId: userId,
                    domainId: domainId,
                    account: account,
                    addresses: [{
                        name: req.user.firstName + ' ' + req.user.lastName,
                        address: [account, domain.main].join('@'),
                        isAlias: false
                    }]
                })
                .run(r.conn)
                .then(function() {
                    return r
                    .table('folders')
                    .insert({
                        folderId: folderId,
                        accountId: accountId,
                        parent: null,
                        displayName: 'Inbox',
                        description: 'Main Inbox',
                        mutable: false
                    })
                    .run(r.conn)
                })
                .then(function() {
                    return res.status(200).send(accountId);
                })
            })
        })
        .catch(function(e) {
            return next(e);
        })

        break;

        default:
        throw new Error('Not implemented.');
        break;
    }

})

var batchMoveToTrashAndRemoveFolder = Promise.method(function(r, fromFolder, trashFolder) {
    return r
    .table('messages', {readMode: 'majority'})
    .between([fromFolder, r.minval], [fromFolder, r.maxval], {index: 'folderSaved'})
    .update({
        folderId: trashFolder
    })
    .run(r.conn)
    .then(function() {
        return r
        .table('folders', {readMode: 'majority'})
        .get(fromFolder)
        .delete()
        .run(r.conn)
        .then(function(result) {
            return result;
        })
    })
})

var doAddFolder = Promise.method(function(r, data) {
    var id = shortid.generate();
    data.folderId = id;
    return r
    .table('folders', {readMode: 'majority'})
    .insert(data)
    .run(r.conn)
    .then(function(result) {
        return result;
    })
})

var doUpdateFolder = Promise.method(function(r, folderId, data) {
    return r
    .table('folders')
    .get(folderId)
    .update(data)
    .run(r.conn)
    .then(function(result) {
        return result;
    })
})

var doUpdateMail = Promise.method(function(r, messageId, accountId, data) {
    return helper.auth.messageAccountMapping(r, messageId, accountId)
    .then(function() {
        return r
        .table('messages', {readMode: 'majority'})
        .get(messageId)
        .update(data)
        .run(r.conn)
        .then(function(result) {
            return result;
        })
    })
})

var parentTest = Promise.method(function(parent) {
    if (noChildrenAllowed.indexOf(parent.displayName.toLowerCase().trim()) !== -1) { // Some folders do not allow children
        throw new Exception.BadRequest('Cannot nest under this folder.');
    }else{
        return true;
    }
})

module.exports = router;

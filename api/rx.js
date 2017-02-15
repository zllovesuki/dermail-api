var express = require('express'),
	router = express.Router(),
	path = require('path'),
	_ = require('lodash'),
    crypto = require('crypto'),
	helper = require('../lib/helper'),
	Promise = require('bluebird'),
	fs = Promise.promisifyAll(require("fs"));

var Exception = require('../lib/error');

var auth = helper.auth.middleware;

router.post('/get-s3', auth, function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	return res.status(200).send({ok: true, data: config.s3});
})

router.post('/setup-tx', auth, function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	if (!!!config.domainName) {
		return next(new Error('API is not setup correctly.'));
	}

	return res.status(200).send({ok: true, domainName: config.domainName});

})

router.post('/notify', auth, function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var r = req.r;

	var message = req.body;
	return helper.notification.sendAlert(r, message.userId, message.level, message.msg)
	.then(function() {
		return res.status(200).send({ok: true});
	})
	.catch(function(e) {
		req.log.error(e);
		return res.send({ok: false, message: e});
	})

})

router.post('/store-tx', auth, function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var r = req.r;
	var messageQ = req.Q;

	var message = req.body;

    var job = messageQ.createJob({
		type: 'saveTX',
		payload: {
			message: message
		}
	}).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
	return messageQ.addJob(job)
	.then(function() {
		return res.status(200).send({ok: true});
	})
	.catch(function(e) {
		req.log.error(e);
		return res.status(200).send({ok: false, message: e});
	})

});

router.post('/check-recipient', auth, function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;
	var r = req.r;

	var email = req.body.to || null;
	if (!!!email) {
		return res.status(200).send({ok: false});
	}
	var account = email.substring(0, email.lastIndexOf("@")).toLowerCase();
	var domain = email.substring(email.lastIndexOf("@") +1).toLowerCase();

	// We want to strip out the "alias"
	var plusSign = account.indexOf('+');
	if (plusSign !== -1) {
		account = account.substring(0, plusSign);
	}

	return checkDomain(r, domain).then(function(domainResult) {
		return checkAccount(r, account, domainResult.domainId).then(function(accountResult) {
			return res.status(200).send({ok: true});
		})
	})
	.catch(function(e) {
		req.log.error(e);
		if (e.name === 'Unauthorized') {
			// Indeed unauthorized
			return res.status(200).send({ok: false});
		}else{
			// Database error
			return next(e);
		}
	})
});

router.post('/process-from-raw', auth, function(req, res, next) {
	res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var r = req.r;
	var messageQ = req.Q;

	var connection = req.body;

	var envelopeTo = connection.envelope.rcptTo[0];
	var recipient = null;
	if (typeof envelopeTo !== 'undefined') {
		if (envelopeTo.hasOwnProperty('address')) {
			recipient = envelopeTo.address.toLowerCase();
		}
	}

	if (!!!recipient) {
		return res.send({ok: false, message: 'No envelopeTo.'});
	}

	var recipientAccount = recipient.substring(0, recipient.lastIndexOf("@")).toLowerCase();
	var recipientDomain = recipient.substring(recipient.lastIndexOf("@") +1).toLowerCase();

	// We want to strip out the "alias"
	var plusSign = recipientAccount.indexOf('+');
	if (plusSign !== -1) {
		recipientAccount = recipientAccount.substring(0, plusSign);
	}

	return checkDomain(r, recipientDomain).then(function(domainResult) {
		var domainId = domainResult.domainId;
		return checkAccount(r, recipientAccount, domainId).then(function(accountResult) {
            var job = messageQ.createJob({
				type: 'processRaw',
				payload: {
					accountId: accountResult.accountId,
					userId: accountResult.userId,
					myAddress: recipient,
					connection: connection,
					recipientIsAnAlias: (plusSign !== -1)
				}
			}).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(1 * 2000)
			return messageQ.addJob(job)
		})
	})
	.then(function() {
		return res.status(200).send({ok: true});
	})
	.catch(function(e) {
		req.log.error(e);
		// Edge cases where the database is not available when "check-recipient" was excuted
		// Also, return false if the database is not available
		return res.status(200).send({ok: false});
	})
});

router.post('/greylist', auth, function(req, res, next) {
    res.setHeader('Content-Type', 'application/json');

	var config = req.config;

	var r = req.r;
	var ip2asn = req.ip2asn;

	var triplet = req.body;

    return checkWhitelist(r, req.log, ip2asn, triplet.ip)
    .then(function(automaticWhitelist) {
        if (automaticWhitelist) return true;

        var time = Math.round(+new Date()/1000);

        var hash = crypto.createHash('md5').update([triplet.ip, triplet.from, triplet.to].join(',')).digest('hex');

        return r.table('greylist')
        .get(hash)
        .run(r.conn, {
            readMode: 'majority'
        })
        .then(function(result) {
            if (result === null) {
                // new greylist
                return r.table('greylist')
                .insert({
                    hash: hash,
                    triplet: triplet,
                    lastSeen: time,
                    whitelisted: false
                })
                .run(r.conn, {
                    readMode: 'majority'
                })
                .then(function() {
                    return false;
                })
            }else{
                // whitelisted, check expiration or renew
                if (result.whitelisted) {
                    var whitelistExpiration = 30 * 24 * 60 * 60; // 30 days
                    // whitelist expires after 30 days
                    if (time - result.lastSeen > whitelistExpiration) {
                        return r.table('greylist').get(hash).delete()
                        .run(r.conn, {
                            readMode: 'majority'
                        })
                        .then(function() {
                            return false;
                        })
                    }
                    // we will renew its whitelist
                    return r.table('greylist')
                    .get(hash)
                    .update({
                        lastSeen: time
                    })
                    .run(r.conn, {
                        readMode: 'majority'
                    })
                    .then(function() {
                        return true;
                    })
                }

                // greylist already exist, check elapsed time
                var minimumWait = 3 * 60; // 3 minutes
                var expiration = 6 * 60 * 60; // 6 hours
                if (time - result.lastSeen < minimumWait) {
                    // still within greylist perioid
                    return false;
                }
                if (time - result.lastSeen > expiration) {
                    // expired, please try again
                    return r.table('greylist').get(hash).delete()
                    .run(r.conn, {
                        readMode: 'majority'
                    })
                    .then(function() {
                        return false;
                    })
                }
                // we should whitelist this triplet
                return r.table('greylist')
                .get(hash)
                .update({
                    lastSeen: time,
                    whitelisted: true
                })
                .run(r.conn, {
                    readMode: 'majority'
                })
                .then(function() {
                    return true;
                })
            }
        })
    })
    .then(function(good) {
        return res.status(200).send({ok: good})
    })
    .catch(function(e) {
        return next(e);
    })
})

var checkWhitelist = function(r, logger, ip2asn, ip) {
    return Promise.all([
        r.table('greylist').get('whitelist-ASN').run(r.conn, { readMode: 'majority' }),
        r.table('greylist').get('whitelist-name').run(r.conn, { readMode: 'majority' }),
        r.table('greylist').get('blacklist-ASN').run(r.conn, { readMode: 'majority' }),
        r.table('greylist').get('blacklist-name').run(r.conn, { readMode: 'majority' })
    ]).spread(function(whitelistASN, whitelistName, blacklistASN, blacklistName) {
        if (whitelistASN === null) whitelistASN = [];
        else whitelistASN = whitelistASN.value;

        if (whitelistName === null) whitelistName = [];
        else whitelistName = whitelistName.value;

        if (blacklistASN === null) blacklistASN = [];
        else blacklistASN = blacklistASN.value;

        if (blacklistName === null) blacklistName = [];
        else blacklistName = blacklistName.value;

        var isp = ip2asn.lookup(ip)

        if (isp === null) {
            logger.info({ message: 'Cannot find ISP for: ' + ip + ', falling back to greylist' })
            return false;
        }

        isp.asn = 'AS' + isp.asn;

        var badASN = blacklistASN.reduce(function(bad, asn) {
            if (isp.asn.toLowerCase().indexOf(asn.toLowerCase()) !== -1) {
                logger.info({ message: 'Automatic Blacklist (ASN): ' + ip, isp: isp })
                bad = true;
            }
            return bad;
        }, false)
        var badName = blacklistName.reduce(function(bad, name) {
            if (isp.name.toLowerCase().indexOf(name.toLowerCase()) !== -1) {
                logger.info({ message: 'Automatic Blacklist (Name): ' + ip, isp: isp })
                bad = true;
            }
            return bad;
        }, false)

        if (badASN || badName) return false;

        var goodASN = whitelistASN.reduce(function(good, asn) {
            if (isp.asn.toLowerCase().indexOf(asn.toLowerCase()) !== -1) {
                logger.info({ message: 'Automatic Whitelist (ASN): ' + ip, isp: isp })
                good = true;
            }
            return good;
        }, false)
        var goodName = whitelistName.reduce(function(good, name) {
            if (isp.name.toLowerCase().indexOf(name.toLowerCase()) !== -1) {
                logger.info({ message: 'Automatic Whitelist (Name): ' + ip, isp: isp })
                good = true;
            }
            return good;
        }, false)
        if (!goodASN && !goodName) {
            logger.info({ message: 'No Automatic Whitelist: ' + ip, isp: isp })
        }
        return goodASN || goodName;
    })
}

var checkDomain = Promise.method(function (r, domain) {
	return r
	.table('domains', {readMode: 'majority'})
	.getAll(domain, {index: 'domain'})
	.slice(0, 1)
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	}).then(function(result) {
		if (result.length === 0) {
			// Maybe it is one of the alias?
			return r
			.table('domains', {readMode: 'majority'})
			.getAll(domain, {index: 'alias'})
			.slice(0, 1)
			.run(r.conn)
			.then(function(cursor) {
				return cursor.toArray();
			}).then(function(result) {
				if (result.length === 0) {
					throw new Exception.Unauthorized('Domain does not exist: ' + domain);
				}else{
					return result[0];
				}
			});
		}else{
			return result[0];
		}
	})
})

var checkAccount = Promise.method(function (r, account, domainId) {
	return r
	.table('accounts', {readMode: 'majority'})
	.getAll([account, domainId], {index: 'accountDomainId'})
	.slice(0, 1)
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	}).then(function(result) {
		if (result.length === 0) {
			throw new Exception.Unauthorized('Account does not exist: ' + account);
		}else{
			return result[0];
		}
	})
})

module.exports = router;

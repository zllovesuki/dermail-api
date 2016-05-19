var express = require('express'),
	router = express.Router(),
	passport = require('passport'),
	validator = require('validator'),
	config = require('../config'),
	_ = require('lodash'),
	helper = require('../lib/helper'),
	Promise = require('bluebird'),
	unNeededFields = [
		'showMore',
		'toBox',
		'recipients'
	];

var auth = passport.authenticate('jwt', { session: false });

router.post('/sendMail', auth, function(req, res, next) {

	var r = req.r;
	var config = req.config;
	var messageQ = req.Q;

	var userId = req.user.userId;
	var compose = req.body;
	var accountId = req.body.accountId;

	if (req.user.accounts.indexOf(compose.accountId) === -1) {
		return res.status(403).send({message: 'Unspeakable horror.'}); // Early surrender: account does not belong to user
	}

	if (compose.recipients.to.length === 0) {
		return res.status(400).send({message: 'At least one "to" recipient is required.'});
	}

	delete compose.to;
	delete compose.cc;
	delete compose.bcc; // Better safe than sorry

	if (typeof compose.addHTML !== 'undefined') {
		compose.html += compose.addHTML;
		delete compose.addHTML;
	}

	compose.html = compose.html || '';

	return Promise.map(Object.keys(compose.recipients), function(each) {
		return Promise.map(compose.recipients[each], function(recipient) {
			if (!validator.isEmail(recipient.address)) {
				throw new Error('Invalid email: ' + recipient.address);
			}
		}, { concurrency: 3 })
	}, { concurrency: 3 })
	.then(function() {
		return helper.auth.userAccountMapping(r, userId, accountId)
	})
	.then(function(account) {
		var sender = {};
		sender.name = req.user.firstName + ' ' + req.user.lastName;
		sender.address = account['account'] + '@' + account['domain'];
		return queueToTX(r, config, sender, account.accountId, userId, compose, messageQ)
	})
	.then(function() {
		return res.status(200).send();
	})
	.catch(function(err) {
		console.log(err);
		return res.status(400).send({message: err});
	})
});

var queueToTX = Promise.method(function(r, config, sender, accountId, userId, compose, messageQ) {
	var recipients = _.cloneDeep(compose.recipients);
	compose.from = sender;
	compose.userId = userId;
	compose.accountId = accountId;
	unNeededFields.forEach(function(field) {
		delete compose[field];
	})
	_.merge(compose, recipients);
	return messageQ.add({
		type: 'queueTX',
		payload: compose
	}, config.Qconfig)
})

module.exports = router;

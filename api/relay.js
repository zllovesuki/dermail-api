var express = require('express'),
	router = express.Router(),
	passport = require('passport'),
	validator = require('validator'),
	async = require('async'),
	config = require('../config'),
	_ = require('lodash'),
	helper = require('../lib/helper'),
	Promise = require('bluebird'),
	mailcomposer = require("mailcomposer"),
	MailParser = require("mailparser").MailParser,
	htmlToText = require('html-to-text'),
	unNeededFields = [
		'showMore',
		'accountId',
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

	async.each(compose.recipients, function(each, cb) {
		async.each(each, function(address, b) {
			if (validator.isEmail(address.address)) {
				b();
			}else{
				b('Invalid email: ' + address.address);
			}
		}, function(err) {
			cb(err);
		})
	}, function(err) {
		if (err) {
			return res.status(400).send({message: err});
		}

		return helper
		.userAccountMapping(r, userId, accountId)
		.then(function(account) {
			return helper
			.getInternalFolder(r, accountId, 'Sent')
			.then(function(sentFolder) {
				var sender = {};
				sender.name = req.user.firstName + ' ' + req.user.lastName;
				sender.address = account['account'] + '@' + account['domain'];
				return doSendMail(r, config, sender, account.accountId, userId, compose, sentFolder, messageQ)
				.then(function() {
					return res.status(200).send();
				})
			})
		})
		.catch(function(e) {
			return next(e);
		})
	})
});

function keepACopyInSentFolder(r, accountId, sender, compose, sentFolder) {
	return new Promise(function (resolve, reject) {
		var mail = mailcomposer(compose);
		var stream = mail.createReadStream();
		var mailparser = new MailParser();
		mailparser.on("end", function(message){

			// dermail-smtp-inbound processMail();
			message.cc = message.cc || [];
			message.attachments = message.attachments || [];
			message.date = message.date.toISOString();

			// Compatibility with MTA-Worker
			message.text = htmlToText.fromString(message.html);

			var myAddress = sender.address;

			for (key in message.from) {
				if (message.from[key].address == myAddress) {
					delete message.from[key];
				}
			}

			return Promise.join(
				// Perspective is relative. "From" in the eyes of RX, "To" in the eyes of TX
				helper.getArrayOfFromAddress(r, accountId, message.to),
				// Perspective is relative. "To" in the eyes of RX, "From" in the eyes of TX
				helper.getArrayOfToAddress(r, accountId, myAddress, message.from),
				function(arrayOfToAddress, arrayOfFromAddress) {
					return helper.saveMessage(r, accountId, sentFolder, arrayOfToAddress, arrayOfFromAddress, message, true)
				}
			)
			.then(function() {
				return resolve();
			})
			.catch(function(e) {
				return reject(e);
			})
		});
		stream.pipe(mailparser);
	})
}

var doSendMail = Promise.method(function(r, config, sender, accountId, userId, compose, sentFolder, messageQ) {
	var recipients = _.cloneDeep(compose.recipients);
	compose.from = sender;
	compose.userId = userId;
	unNeededFields.forEach(function(field) {
		delete compose[field];
	})
	_.merge(compose, recipients);
	return messageQ.add({
		type: 'sendMail',
		payload: compose
	}, config.Qconfig)
	.then(function() {
		return keepACopyInSentFolder(r, accountId, sender, compose, sentFolder)
	})
})

module.exports = router;

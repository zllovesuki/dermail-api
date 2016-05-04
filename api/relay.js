var express = require('express'),
	router = express.Router(),
	passport = require('passport'),
	validator = require('validator'),
	async = require('async'),
	config = require('../config'),
	_ = require('lodash'),
	helper = require('../lib/helper'),
	common = require('dermail-common'),
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
			return common
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

function keepACopyInSentFolder(r, accountId, compose, sentFolder) {
	return new Promise(function (resolve, reject) {
		return Promise.try(function() {
			var mail = mailcomposer(compose);
			var stream = mail.createReadStream();
			var mailparser = new MailParser();
			mailparser.on("end", function(message){

				// dermail-smtp-inbound processMail();
				message.cc = message.cc || [];
				message.attachments = message.attachments || [];
				message.date = message.date.toISOString();

				async.each(message.from, function(one, cb) {
					async.waterfall([
						// 2. Get our addressId
						function (done) {
							return common
							.getAddress(r, one.address, accountId)
							.then(function(addressObject) {
								var addressId = addressObject.addressId;
								var arrayOfFromAddress = [addressId];
								return done(null, message, arrayOfFromAddress);
							})
							.catch(function(e) {
								return done(e);
							})
						},
						// 3. Assign "to" address in the database
						function (message, arrayOfFromAddress, done) {

							var arrayOfToAddress = [];

							async.each(message.to, function(one, cb) {
								if (!one) {
									return cb();
								}
								return common
								.getOrCreateAddress(r, one, accountId)
								.then(function(addressId) {
									arrayOfToAddress.push(addressId);
									return cb();
								})
								.catch(function(e) {
									return cb(e);
								})
							}, function(err) {
								if (err) {
									return done(err);
								}else{
									message.from = arrayOfFromAddress;
									message.to = arrayOfToAddress;
									return done(null, message);
								}
							});
						},
						// Save the headers, attachments, and message
						function (message, done) {
							var headers = _.cloneDeep(message.headers);
							delete message.headers;
							var attachments = _.cloneDeep(message.attachments);
							delete message.attachments;

							// Assign folder
							message.folderId = sentFolder;
							// Assign account
							//message.userId = accountResult.userId;
							message.accountId = accountId;
							// Default value
							message.isRead = true;
							message.isStar = false;
							message.text = htmlToText.fromString(message.html);

							//delete default messageId, if it has one
							if (message.hasOwnProperty('messageId')) {
								message._messageId = _.clone(message.messageId);
								delete message.messageId;
							}

							return Promise.join(
								helper.saveHeaders(r, headers),
								helper.saveAttachments(r, attachments),
								function(headerId, arrayOfAttachments) {
									message.headers = headerId;
									message.attachments = arrayOfAttachments;
									return common
									.saveMessage(r, message)
								}
							)
							.then(function(messageId) {
								return done(null);
							})
							.catch(function(e) {
								return done(e);
							})
						}
					], function(err) {
						return cb(err);
					});
				}, function(err) {
					if (err) {
						return reject(err);
					}else{
						return resolve();
					}
				});
			});
			stream.pipe(mailparser);
		})
		.catch(function(e) {
			return reject(e);
		})
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
		return keepACopyInSentFolder(r, accountId, compose, sentFolder)
	})
})

module.exports = router;

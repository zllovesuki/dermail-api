var express = require('express'),
	router = express.Router(),
	validator = require('validator'),
	config = require('../config'),
	_ = require('lodash'),
	moment = require('moment'),
	helper = require('../lib/helper'),
	Promise = require('bluebird'),
	unNeededFields = [
		'showMore',
		'toBox',
		'recipients',
		'type'
	];

var auth = helper.auth.middleware;

router.post('/sendMail', auth, function(req, res, next) {

	var r = req.r;
	var config = req.config;
	var messageQ = req.Q;

	var userId = req.user.userId;
	var compose = req.body;
	var accountId = req.body.accountId;

	if (req.user.accounts.indexOf(compose.accountId) === -1) {
		return next(new Error('Unspeakable horror.')); // Early surrender: account does not belong to user
	}

	if (compose.recipients.to.length === 0) {
		return next(new Error('At least one "to" recipient is required.'));
	}

	delete compose.to;
	delete compose.cc;
	delete compose.bcc; // Better safe than sorry

	compose.html = compose.html || '';

	// Reply speicifc
	if ( (compose.type === 'reply' || compose.type === 'forward') && !!!compose.inReplyTo) {
		return next(new Error('"inReplyTo" field is required for replying/forwarding.'))
	}

	var constructor = Promise.method(function() {

	});

	var actual = function() {
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
	}

	return constructor()
	.then(function() {
		if (compose.type !== 'new') {
			return checkForInReplyTo(r, compose.inReplyTo)
			.then(function(results) {
				if (results.length === 0) {
					throw new Error('"inReplyTo" points to a non-existent message.');
				}
				var original = results[0];
				var obj;

				compose.references.push(compose.inReplyTo);

				if (typeof original.replyTo !== 'undefined') {
					obj = emailToObject(original.replyTo[0]);
				}else{
					obj = original.from[0];
				}

				var name = obj.friendlyName;
				var email = obj.account + '@' + obj.domain;

				switch (compose.type) {
					case 'reply':
					// Reply specificed

					compose.addHTML = '<div class="dermail_extra"><br>' +
						'<div class="dermail_quote">On ' + moment(original.date).format("ddd, MMM D, YYYY [at] hh:mm a") +
						', ' + name + ' &lt;<a href="mailto:' + email + '" target="_blank">' + email +
						'</a>&gt; wrote: <br><blockquote class="dermail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">' +
						original.html + '</blockquote></div></div>';

					break;
					case 'forward':
					// Forward specificed

					var originalRecipient = original.envelopeTo[0].address;

					compose.addHTML = '<div class="dermail_extra"><br>' +
						'<div class="dermail_quote">---------- Forwarded message ----------<br>' +
						'From: ' + (name.length > 0 ? name + ' ' : '') + '&lt;<a href="mailto:' + email + '" target="_blank">' + email + '</a>&gt;<br>'+
						'Date: ' + moment(original.date).format("ddd, MMM D, YYYY [at] hh:mm a") + '<br>' +
						'Subject: ' + original.subject + '<br>' +
						'To: ' + '<a href="mailto:' + originalRecipient + '" target="_blank">' + originalRecipient + '</a><br><br><br>'+
						original.html + '</div></div>';

					break;
					default:
					break;
				}
			})
		}
	})
	.then(function() {
		if (typeof compose.addHTML !== 'undefined') {
			compose.html += compose.addHTML;
			delete compose.addHTML;
		}
	})
	.then(actual)
	.then(function() {
		return res.status(200).send();
	})
	.catch(function(err) {
		console.log(err);
		return next(new Error(err));
	})
});

var emailToObject = function(email) {
	return {
		account: email.address.substring(0, email.address.lastIndexOf("@")).toLowerCase(),
		domain: email.address.substring(email.address.lastIndexOf("@") +1).toLowerCase(),
		friendlyName: email.name
	}
}

var checkForInReplyTo = function(r, _messageId) {
	return r
	.table('messages', { readMode: 'majority' })
	.getAll(_messageId, { index: '_messageId' })
	.map(function(d) {
		return d.merge(function(doc) {
			return {
				'to': doc('to').concatMap(function(to) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(to).without('accountId', 'addressId', 'internalOwner')]
				}),
				'from': doc('from').concatMap(function(from) { // It's like a subquery
					return [r.table('addresses', {readMode: 'majority'}).get(from).without('accountId', 'addressId', 'internalOwner')]
				})
			}
		})
	})
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
}

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

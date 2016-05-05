var Promise = require('bluebird'),
	push = require('web-push'),
	crypto = require('crypto'),
	_ = require('lodash');

var self = module.exports = {
	queueNewMailNotification: Promise.method(function(r, userId, accountId, msg) {
		var insert = {};
		insert.userId = userId;
		insert.accountId = accountId;
		insert.type = 'new';
		insert.message = msg;
		return r
		.table('queue')
		.insert(insert)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(queueId) {
			return queueId;
		})
	}),
	sendNotification: Promise.method(function(r, gcm_api_key, payload, subscription) {

		push.setGCMAPIKey(gcm_api_key);

		var params = {};

		var notify = function(ep, pa) {
			push.sendNotification(ep, pa);
		}

		if (typeof subscription.keys !== 'undefined') {
			params = {
				userPublicKey: subscription.keys.p256dh,
				userAuth: subscription.keys.auth,
				payload: JSON.stringify(payload)
			};
			return notify(subscription.endpoint, params);
		}else {
			var hash = crypto.createHash('sha1').update(subscription.endpoint).digest("hex");

			return r
			.table('payload')
			.insert({
				endpoint: hash,
				payload: payload
			})
			.run(r.conn)
			.then(function() {
				return notify(subscription.endpoint, params);
			})
		}
	})
}

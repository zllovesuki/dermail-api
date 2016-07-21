var express = require('express'),
	router = express.Router(),
	jwt = require('jwt-simple'),
	bcrypt = require("bcrypt"),
	helper = require('../lib/helper'),
	Exception = require('../lib/error');

router.post('/', function(req, res, next) {

	var config = req.config;
	var r = req.r;

	var username = req.body.username;
	var password = req.body.password;

	if (!username || !password) {
		return next(new Error('Username and password are required'));
	}

	return r
	.table('users', {readMode: 'majority'})
	.getAll(username, {index: 'username'})
	.pluck('userId', 'password')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(user) {
		if (user.length === 0) {
			return next(new Exception.Unauthorized('Username or Password incorrect'));
		}
		bcrypt.compare(password, user[0].password, function(err, result) {
			if (err || !result) {
				return next(new Exception.Unauthorized('Username or Password incorrect'));
			}else{
				return helper.auth.getUser(r, user[0].userId)
				.then(function(user) {
					var now = new Date();
					user.iat = Math.round(now.getTime()/1000);
					now.setDate(now.getDate() + 7);
					user.exp = Math.round(now.getTime()/1000);
					return res.status(200).send({token: jwt.encode(user, config.jwt.secret)});
				})
			}
		})
	})
	.error(function(e) {
		return next(e);
	})
});

module.exports = router;

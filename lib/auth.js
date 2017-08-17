var bcrypt = require("bcrypt"),
	JwtStrategy = require('passport-jwt').Strategy,
	ExtractJwt = require('passport-jwt').ExtractJwt;

module.exports = function(config, passport, r) {

	var opts = {}
	opts.jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken();
	opts.secretOrKey = config.jwt.secret;

	passport.use(new JwtStrategy(opts, function(jwt_payload, done) {
		return done(null, jwt_payload);
	}));
}

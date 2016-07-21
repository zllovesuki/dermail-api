'use strict';

module.exports = function Forbidden(message, extra) {
	Error.captureStackTrace(this, this.constructor);
	this.name = this.constructor.name;
	this.status = 403;
	this.message = message;
	this.extra = extra;
};

require('util').inherits(module.exports, Error);

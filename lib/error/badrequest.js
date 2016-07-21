'use strict';

module.exports = function BadRequest(message, extra) {
	Error.captureStackTrace(this, this.constructor);
	this.name = this.constructor.name;
	this.status = 400;
	this.message = message;
	this.extra = extra;
};

require('util').inherits(module.exports, Error);

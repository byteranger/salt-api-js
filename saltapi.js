'use strict';

// UMD Boilerplate (lightly customized from commonJsStrictGlobal)
(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['fetch'], function (fetch) {
			return (root.SaltAPI = factory(fetch));
		});
	} else if (typeof module === 'object' && module.exports) {
		// NodeJS
		module.exports = factory(require('node-fetch'));
	} else {
		// Browser globals
		root.SaltAPI = factory(root.fetch);
	}
}(typeof self !== 'undefined' ? self : this, function (fetch) {

	////// Module definition starts here

	//// Constructor
	function SaltAPI(url, init = {}) {
		// TODO: arg validation
		// TODO: config object merge
		this.url = url;
		this.token = init.token || null;
		this.tokenExpire = init.tokenExpire || null;
		this.tokenRefreshTimer = init.tokenRefreshTimer || null;
		this.tokenAutoRefresh = init.tokenAutoRefresh || false;
		this.waitTries = init.waitTries || 3;
		this.waitSeconds = init.waitSeconds || 10;
		this.debug = init.debug || false;
	}

	//// Utility functions
	////TODO: convert to member functions?

	//TODO: fetch timeout wrapper

	function tResUnauthorized(res) {
		if (res.status == 401)
			throw new Error('Unauthorized');
		return res;
	}

	function tResUnexpected(res) {
		if (!res.ok) {
			throw new Error('Unexpected error, report to admin: ' + res.status + ' - ' + res.statusText);
		}
		return res;
	}

	function eJsonBad(err) {
		throw new Error('Malformed JSON: ' + err.message);
	}

	function tResOk(res) {
		if (res.ok && res.headers.has('Content-Type') && res.headers.get('Content-Type') == 'application/json')
			return res.json().catch(eJsonBad);
		return res; //TODO: throw error?
	}

	function tSaltRet0(fn, json) {
		//DEBUG: console.log('tSaltRet0', 'json=', json, 'fn=', fn, typeof fn);
		if (json === null || typeof json !== 'object' || !Array.isArray(json.return) || !json.return.length) {
			//TODO: more malformation tests?
			throw new Error('Malformed response from server');
		}
		var ret = json.return[0];
		if (typeof fn === 'function') ret = fn(ret);
		return ret;
	}

	//// Member functions

	// login
	SaltAPI.prototype.login = function (username, password) {
		var _this = this;
		return fetch(_this.url + '/login', {
			redirect: 'manual',
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				eauth: 'pam',
				username: username,
				password: password,
			}),
		})
		.then(function (res) {
			if (res.status == 401)
				throw new Error('Bad username or password');
			return res;
		})
		// Also possible, but treating generically...
		// 400: // Bad Request
		// 406: // Not Acceptable
		// 500: // Internal Server Error
		.then(tResUnexpected)
		.then(tResOk)
		.then(tSaltRet0.bind(undefined, function (auth) {
			if (_this.debug) console.log('Login', 'auth=', auth);
			//TODO: try/catch/throw Error?
			_this.token = auth.token;
			_this.tokenExpire = new Date(auth.expire * 1000);
			if (_this.tokenAutoRefresh) {
				var msRefresh = _this.tokenExpire - Date.now();
				if (msRefresh <= 0)
					throw new Error('Token already expired');
				_this.tokenRefreshTimer = setTimeout(_this.login.bind(_this), msRefresh, username, password);
				if (_this.debug)
					console.log('Login auto refresh', 'msRefresh=', msRefresh, 'tokenRefreshTimer=', _this.tokenRefreshTimer);
			}
			//TODO: return true/false?
			return auth;
		}));
	};

	// start a job
	SaltAPI.prototype.start = function (target = '*', command = 'test.ping', args = undefined, kwargs = undefined) {
		var _this = this;
		if (_this.debug) console.log('Start', 'target=', target, 'command=', command, 'args=', args, 'kwargs=', kwargs);
		//TODO: support array of targets?
		//TODO: configurable target type?
		return fetch(_this.url + '/minions', {
			method: 'POST',
			redirect: 'manual',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'X-Auth-Token': _this.token,
			},
			body: JSON.stringify({
				tgt_type: 'compound',
				tgt: target,
				fun: command,
				arg: args,
				kwarg: kwargs,
			}),
		})
		.then(tResUnauthorized)
		.then(tResUnexpected)
		.then(tResOk)
		.then(tSaltRet0.bind(undefined, undefined));
	};

	// poll job for result
	SaltAPI.prototype.poll = function (job) {
		var _this = this;
		if (_this.debug) console.log('Poll', job);
		switch (typeof job) {
			case 'object':
				if (!job.jid || typeof job.jid != 'string')
					return Promise.reject(new Error('Object is not a proper job object'));
				job = job.jid;
				break;
			case 'array':
				return Promise.reject(new Error('Arrays of JIDs are not yet supported'));
				break;
		}
		return fetch(_this.url + '/jobs/' + job, {
			redirect: 'manual',
			headers: {
				'Accept': 'application/json',
				'X-Auth-Token': _this.token,
			},
		})
		.then(tResUnauthorized)
		.then(tResUnexpected)
		.then(tResOk)
		.then(tSaltRet0.bind(undefined, undefined));
	};

	// wait for job completion
	SaltAPI.prototype.wait = function (job) {
		var _this = this;
		var tries = 0;
		return new Promise(function waiter(resolve, reject) {
			_this.poll(job)
			.then(function (job) {
				if (_this.debug) console.log('Wait poll', tries, job); //DEBUG
				if (job.Minions && job.Result && job.Minions.length == Object.keys(job.Result).length) {
					// Job's done
					resolve(job);
				} else {
					if (++tries < _this.waitTries ) {
						// Try again after a bit
						setTimeout(waiter, _this.waitSeconds * 1000, resolve, reject);
					} else {
						// Give up waiting and return what we have
						resolve(job);
					}
				}
			})
			//TODO: more complex reject logic on fetch failure?
			.catch(reject);
		});
	};

	// logout
	SaltAPI.prototype.logout = function () {
		clearTimeout(this.tokenRefreshTimer);
		this.tokenRefreshTimer = null;
		this.tokenExpire = null;
		this.token = null;
	};

	return SaltAPI;

}));

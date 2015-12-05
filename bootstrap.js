/* ***** BEGIN LICENSE BLOCK *****
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
 *
 * Contributor(s):
 *   Diego Casorran <dcasorran@gmail.com> (Original Author)
 *   Jeroen van Warmerdam <jeronevw@hotmail.com>
 *
 * ***** END LICENSE BLOCK ***** */

let {classes:Cc,interfaces:Ci,utils:Cu,results:Cr} = Components, addon;

Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function LOG(m) (m = addon.name + ' Message @ '
	+ (new Date()).toISOString() + "\n> " + m,
		dump(m + "\n"), Services.console.logStringMessage(m));

let i$ = {
	onOpenWindow: function(aWindow) {
		loadIntoWindowStub(aWindow
			.QueryInterface(Ci.nsIInterfaceRequestor)
			.getInterface(Ci.nsIDOMWindow));
	},
	wmf: function(callback) {
		let w = Services.wm.getEnumerator('navigator:browser');
		while(w.hasMoreElements())
			callback(w.getNext()
				.QueryInterface(Ci.nsIDOMWindow));
	},
	onCloseWindow: function() {},
	onWindowTitleChange: function() {}
};

let showAlertNotification = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
showAlertNotification = showAlertNotification.showAlertNotification.bind(showAlertNotification);

function iNotify(aAddon, aMsg, callback) {
	let nme = addon.branch.getIntPref('nme');

	if(nme > 1) {
		if(nme == 3) try {
			if(aAddon) {
				let info = {
					installs: [{addon:aAddon,name:aAddon.name + ' ' + aAddon.version}],
					originatingWindow: Services.wm.getMostRecentWindow('navigator:browser').gBrowser.contentWindow,
					QueryInterface: XPCOMUtils.generateQI([Ci.amIWebInstallInfo])
				};
				Services.obs.notifyObservers(info, 'addon-install-complete', null);
				return callback(null);
			}
		} catch(e) {
			Cu.reportError(e);
		}
		showAlertNotification(addon.icon,addon.name,aMsg,!1,"",
			(s,t) => t == "alertshow" || callback(t));
	} else {
		if(nme) Services.prompt.alert(null,addon.name,aMsg);

		callback();
	}
}

function onClickHanlder(ev) {
	ev.preventDefault();

	if(this.hasAttribute(addon.tag)) {
		Services.prompt.alert(null,addon.name,
			"Don't click me more than once, reload the page to retry.");
		return;
	}

	this.setAttribute(addon.tag,1);
	this.className += ' danger disabled';
	let d = this.ownerDocument,
		l = this.lastChild,
		f = this.firstChild;
	l.textContent = ' Installing...';
	f.className = f.className.replace('plus','hourglass');
	d.body.appendChild(d.createElement('style')).textContent = '@keyframes '
		+addon.tag+'{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
	f.style.animation = addon.tag + ' 3s infinite linear';

	xhr(this.href || this.getAttribute('href'),data => {
		let iStream = Cc["@mozilla.org/io/arraybuffer-input-stream;1"]
			.createInstance(Ci.nsIArrayBufferInputStream);

		iStream.setData(data,0,data.byteLength);

		let nFile = FileUtils.getFile("TmpD", [Math.random()]),
			oStream = FileUtils.openSafeFileOutputStream(nFile);

		NetUtil.asyncCopy(iStream, oStream, aStatus => {
			if(!Components.isSuccessCode(aStatus)) {
				Services.prompt.alert(null,addon.name,
					'Error ' +aStatus+ ' writing to ' +nFile.path);
			} else {
				let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"]
						.createInstance(Ci.nsIZipReader),
					zipWriter = Cc["@mozilla.org/zipwriter;1"]
							.createInstance(Ci.nsIZipWriter);

				let oFile = FileUtils.getFile("TmpD", [addon.tag+'.xpi']);
				zipReader.open(nFile);
				zipWriter.open(oFile, 0x2c);

				let p = (this.getAttribute('path') || "*/"),
					m = zipReader.findEntries(p + "*");
				p = p.substr(2);
				while(m.hasMore()) {
					let f = m.getNext(),
						e = zipReader.getEntry(f);

					if(!(e instanceof Ci.nsIZipEntry))
						continue;

					let n = (e.name||f).replace(/^[^\/]+\//,'').replace(p,'');
					if(!n) continue;

					if(e.isDirectory) {

						zipWriter.addEntryDirectory(n,e.lastModifiedTime,!1);

					} else {

						zipWriter.addEntryStream(n, e.lastModifiedTime,
							Ci.nsIZipWriter.COMPRESSION_FASTEST,
							zipReader.getInputStream(f), !1);
					}
				}

				zipReader.close();
				zipWriter.close();

				AddonManager.getInstallForFile(oFile,aInstall => {
					let done = (aMsg,aAddon) => {
						let c = 'check';
						if(typeof aMsg === 'number') {
							l.textContent = 'Error ' + aMsg;
							aMsg = 'Installation failed ('+aMsg+')';
							c = 'alert';
						} else {
							l.textContent = 'Succeed!';
							this.className = this.className.replace('danger','');
						}
						f.style.animation = null;
						f.className = f.className.replace('hourglass',c);
						iNotify(aAddon, aMsg, aResult => {
							oFile.remove(!1);

							if(aResult !== null && aAddon && aAddon.pendingOperations) {
								let m = aAddon.name + ' requires restart.\n\n'
									+ 'Would you like to restart '
									+ Services.appinfo.name + ' now?';

								m = Services.prompt.confirmEx(null,
									addon.name,m,1027,0,0,0,null,{});

								if(!m) {
									let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"]
										.createInstance(Ci.nsISupportsPRBool);

									Services.obs.notifyObservers(cancelQuit,
										"quit-application-requested", null);

									if(!cancelQuit.data) {
										Services.obs.notifyObservers(null,
											"quit-application-granted", null);

										Services.startup.quit(
											Ci.nsIAppStartup.eAttemptQuit |
											Ci.nsIAppStartup.eRestart
										);
									}
								}
							}
						});
					};

					aInstall.addListener({
						onInstallFailed : function(aInstall) {
							aInstall.removeListener(this);

							done(aInstall.error);
						},
						onInstallEnded : function(aInstall,aAddon) {
							aInstall.removeListener(this);

							done(aAddon.name + ' ' + aAddon.version
								+ ' has been installed successfully.',aAddon);
						}
					});
					aInstall.install();
				});

				nFile.remove(!1);
			}
		});
	});
}

function addButton(n,u) {
	if([n.nextElementSibling,n.previousElementSibling]
		.some(e=>e&&~e.className.indexOf(addon.tag)))
			return;

	let p = n.parentNode;
	n = n.cloneNode(!0);

	n.className += ' ' + addon.tag;
	n.title = 'Install Extension';
	n.textContent = ' Add to ' + Services.appinfo.name;
	n.insertBefore(n.ownerDocument.createElement('span'),
		n.firstChild).className = 'octicon octicon-plus';

	if(typeof u !== 'object') {
		p.appendChild(n);
	} else {
		p.insertBefore(n, p.firstElementChild);
	}

	n.addEventListener('click', onClickHanlder, false);

	if(u) {
		let b = n.ownerDocument.querySelector('div.breadcrumb');

		n.setAttribute('href', u );
		n.style.cursor = 'pointer';
		n.style.setProperty('box-shadow','none','important');
		n.setAttribute('path', b && b.textContent
			.replace(" ",'','g').replace(/^[^/]+/,'*')||'');

		if(typeof u !== 'object') {
			n.className += ' button primary pseudo-class-active';
		} else {
			n.className = 'btn btn-sm minibutton pseudo-class-active';
			n.firstChild.style.verticalAlign = 'baseline';
		}
	}
	return n;
}

function onPageLoad(doc) {
	let isMobileSite = (doc.body.firstElementChild.nodeName === 'HEADER');

	if(doc.location.pathname.split('/')[3] === 'pull') {
		// Based on work by Jerone: https://github.com/jerone/UserScripts

		let r = '' + doc.location.pathname.split('/').filter(String).slice(1,2),
			v = addon.branch.getPrefType('prs') && addon.branch.getCharPref('prs') || '';

		if(~v.toLowerCase().split(',').indexOf(r.toLowerCase())) {

			let n = doc.querySelectorAll('span.commit-ref.current-branch.css-truncate.js-selectable-text.expandable')[1],
				b = n.textContent.trim().split(':'),
				t = b.shift(),
				u = [
					'https://github.com', t,
					doc.querySelector('.js-current-repository').textContent,
					'archive', b.join(':') + '.zip'
				].join('/');

			addButton(n,u);
		}
	}
	else if (isMobileSite) {
		if([].some.call(doc.querySelectorAll('a.list-item > :nth-child(2)'),
			(n) => 'install.rdf' === String(Object(n.previousSibling).nodeValue).trim())) {
				let c = 11, n, b;
				while(c-- && !(n=doc.querySelector('.nav-bar-tabs > ul:nth-child(1) > li:nth-child('+c+') > a:nth-child(1)')));

				if(n && n.textContent.trim() === 'Pulse') {
					n = addButton(n);
					b = String(Object(doc.querySelector('.branch-selector-toggle')).textContent).trim();
					n.href = String(n.href).replace('/pulse', '/archive/' + b + '.zip');
				}
			}
	}
	else if([].some.call(doc.querySelectorAll('table.files > tbody > tr > td.content'),
		(n) => 'install.rdf' === n.textContent.trim())) {

		let c = 7, n, z;
		while(c-- && !(n=doc.querySelector('div.file-navigation-option:nth-child('+c+') > a:nth-child(1)')));

		if(n && n.textContent.trim() === 'Download ZIP') {
			c = doc.querySelector('div.only-with-full-nav');

			if(!c || doc.defaultView.getComputedStyle(c).getPropertyValue('display') == 'block') {
				addButton(n);
				c = doc.querySelector('div.file-navigation-options div.input-group');
				if (c) c.style.maxWidth = '260px';
			} else {
				z = n;
				n = 0;
			}
		}

		if(!n) {
			n = doc.querySelector('div.file-navigation');
			n = n && n.firstElementChild;

			if( n ) {

				addButton(n,z);
			}
		}
	}
}

function loadIntoWindow(window) {
	if(window.document.documentElement
		.getAttribute("windowtype") != 'navigator:browser')
			return;

	function onMutation(ms,doc) {
		for(let m of ms) {
			if('class' == m.attributeName) {
				if(~m.oldValue.indexOf('loading')
				|| ~m.oldValue.indexOf('context-loader')) {
					window.setTimeout(onPageLoad.bind(null,doc),1450);
				}
				break;
			}
		}
	}

	let domload = ev => {
		let doc = ev.originalTarget;

		if(!(doc.location && doc.location.host == 'github.com'))
			return;

		['page-context-loader','context-loader','repository-content'].forEach(e => {

			e = doc.getElementsByClassName(e);
			for(let o of e) {
				new doc.defaultView.MutationObserver(m => onMutation(m,doc))
					.observe(o,{attributes:!0,attributeOldValue:!0});
			}
		});

		onPageLoad(doc);
	};
	getBrowser(window).addEventListener('DOMContentLoaded', domload, false);
	addon.wms.set(window,domload);
}

function xhr(url,cb) {
	let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
		.createInstance(Ci.nsIXMLHttpRequest);

	let handler = ev => {
		evf(m => xhr.removeEventListener(m,handler,!1));
		switch(ev.type) {
			case 'load':
				if(xhr.status == 200) {
					cb(xhr.response);
					break;
				}
			default:
				Services.prompt.alert(null,addon.name,
					'Error Fetching Package: '+ xhr.statusText
						+ ' ['+ev.type+':' + xhr.status + ']');
				break;
		}
	};

	let evf = f => ['load','error','abort'].forEach(f);
	evf(m => xhr.addEventListener( m, handler, false));

	xhr.mozBackgroundRequest = true;
	xhr.open('GET', url, true);
	xhr.channel.loadFlags |=
		Ci.nsIRequest.LOAD_ANONYMOUS
		| Ci.nsIRequest.LOAD_BYPASS_CACHE
		| Ci.nsIRequest.INHIBIT_PERSISTENT_CACHING;
	xhr.responseType = "arraybuffer";
	xhr.send(null);
}

function getBrowser(w) {

	if(typeof w.getBrowser === 'function')
		return w.getBrowser();

	if("gBrowser" in w)
		return w.gBrowser;

	return w.BrowserApp.deck;
}

function loadIntoWindowStub(domWindow) {

	if(domWindow.document.readyState == "complete") {
		loadIntoWindow(domWindow);
	} else {
		domWindow.addEventListener("load", function() {
			domWindow.removeEventListener("load", arguments.callee, false);
			loadIntoWindow(domWindow);
		}, false);
	}
}

function unloadFromWindow(window) {
	if(addon.wms.has(window)) {
		getBrowser(window)
			.removeEventListener('DOMContentLoaded',
				addon.wms.get(window), false);
		addon.wms.delete(window);
	}
}

function startup(data) {
	AddonManager.getAddonByID(data.id,data=> {
		addon = {
			id: data.id,
			name: data.name,
			version: data.version,
			icon: data.getResourceURI("icon.png").spec,
			tag: data.name.toLowerCase().replace(/[^\w]/g,''),
			wms: new WeakMap()
		};
		addon.branch = Services.prefs.getBranch('extensions.'+addon.tag+'.');

		i$.wmf(loadIntoWindowStub);
		Services.wm.addListener(i$);

		if(!addon.branch.getPrefType('nme')) {
			addon.branch.setIntPref('nme',2);
		}
		addon.branch.setCharPref('version', addon.version);
	});
}

function shutdown(data, reason) {
	if(reason == APP_SHUTDOWN)
		return;

	Services.wm.removeListener(i$);
	i$.wmf(unloadFromWindow);
}

function install(data, reason) {}
function uninstall(data, reason) {}

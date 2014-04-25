/* ***** BEGIN LICENSE BLOCK *****
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
 *
 * Contributor(s):
 *   Diego Casorran <dcasorran@gmail.com> (Original Author)
 *
 * ***** END LICENSE BLOCK ***** */

let {classes:Cc,interfaces:Ci,utils:Cu,results:Cr} = Components, addon;

Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
const { TextEncoder } = Cu.import("resource://gre/modules/commonjs/toolkit/loader.js", {});

var TEncoder;

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
	
	if (this.classList.contains('disabled')) { //needed for when checking if editable file is installable
		return;
	}

	this.setAttribute(addon.tag,1);
	this.className += ' danger disabled';
	let d = this.ownerDocument,
		l = this.lastChild,
		f = this.firstChild;
	l.textContent = ' Installing...';
	f.className = f.className.replace(/(?:plus|check)/,'hourglass');
	d.body.appendChild(d.createElement('style')).textContent = '@keyframes '
		+addon.tag+'{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
	f.style.animation = addon.tag + ' 3s infinite linear';

	xhr(this.href || this.getAttribute('href'),data => {
		let iStream = Cc["@mozilla.org/io/arraybuffer-input-stream;1"]
			.createInstance(Ci.nsIArrayBufferInputStream);

		iStream.setData(data,0,data.byteLength);

		let nFile = FileUtils.getFile("TmpD", [Math.random()])
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
				
				if (this.hasAttribute('filepath')) {
					var fileName = this.getAttribute('filepath');
					var useUncommitedFilePath = this.getAttribute('filepath').replace(this.getAttribute('path'), ''); //relative to path, because thats what is getting written to xpi
					fileName = fileName.substr(fileName.lastIndexOf('/')+1);					
					var tmpFileOfUncommitedFile = new FileUtils.File(oFile.parent.path + '\\' + fileName)
				}
				
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
						if (useUncommitedFilePath && n == useUncommitedFilePath) {
							//skip adding file
						} else {							
							zipWriter.addEntryStream(n, e.lastModifiedTime,
								Ci.nsIZipWriter.COMPRESSION_FASTEST,
								zipReader.getInputStream(f), !1);
						}
					}
				}

				var btn = this;
				
				var postZipWrite = function() {
					
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
								if (!btn.hasAttribute('filepath')) {
									l.textContent = 'Succeed!';
									btn.className = btn.className.replace('danger','');
								} else {
									//it is uncommited file install so allow reclicking of button
									l.textContent = 'Installed with Uncommitted File - Reinstall';
									btn.classList.remove('danger');
									btn.classList.remove('disabled');
									btn.removeAttribute(addon.tag); //so allows reinstall
								}
							}
							f.style.animation = null;
							f.className = f.className.replace('hourglass',c);
							iNotify(aAddon, aMsg, aResult => {
								OS.File.remove(oFile.path);

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

					OS.File.remove(nFile.path);
				};
				var postZipWriteBinded = postZipWrite.bind(this);
				
				if (this.hasAttribute('filepath')) {
							if (!TEncoder) {
								TEncoder = new TextEncoder(); // This encoder can be reused for several writes
							}
							let BufferArray = TEncoder.encode(this.ownerDocument.querySelector('#blob_contents').value); // Convert the text to an array
							let promiseCreateUncommitedFile = OS.File.writeAtomic(tmpFileOfUncommitedFile.path, BufferArray,	{
								tmpPath: tmpFileOfUncommitedFile.path + '.tmp'
							});
							promiseCreateUncommitedFile.then(
								function() {
									zipWriter.addEntryFile(useUncommitedFilePath,
										Ci.nsIZipWriter.COMPRESSION_FASTEST,
										tmpFileOfUncommitedFile, !1);
									
									OS.File.remove(tmpFileOfUncommitedFile.path);									
									postZipWriteBinded();
								}
							);
				} else {
					postZipWriteBinded();
				}
				

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
			n.className = 'minibutton pseudo-class-active';
			n.firstChild.style.verticalAlign = 'baseline';
		}
	}
	
	return n;
}

function onPageLoad(doc) {
	var editForm = doc.querySelector('.js-blob-form.js-blob-edit-form');
	
	if(doc.location.pathname.replace(/\/[^/]+$/,'').substr(-4) === 'pull') {
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
	else if([].some.call(doc.querySelectorAll('table.files > tbody > tr > td.content'),
		(n) => 'install.rdf' === n.textContent.trim())) {

		let c = 7, n, z;
		while(c-- && !(n=doc.querySelector('a.minibutton:nth-child('+c+')')));

		if(n && n.textContent.trim() === 'Download ZIP') {
			c = doc.querySelector('div.only-with-full-nav');

			if(!c || doc.defaultView.getComputedStyle(c).getPropertyValue('display') == 'block') {
				addButton(n);
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
	else if (editForm && editForm.hasAttribute('action')) {
		var filePath = editForm.getAttribute('action');
		let c = 7, n, z;
		while(c-- && !(n=doc.querySelector('a.minibutton:nth-child('+c+')')));

		if(n && n.textContent.trim() === 'Download ZIP') {
			c = doc.querySelector('div.only-with-full-nav');
			z = n;
			n = 0;
		}

		if(!n) {
			n = doc.querySelector('div.breadcrumb');
			n = n && n.firstElementChild;

			if( n ) {
				var btn = addButton(n,z);
				btn.className += ' danger disabled'
				var l = btn.lastChild;
				var f = btn.firstChild;
				l.textContent = ' Checking if Installable...';
				f.className = f.className.replace('plus','hourglass');
				
				var breadcrumbs = doc.querySelectorAll('span[itemtype*=Breadcrumb]');
				var breads = ['*'];
				for (var i=1; i<breadcrumbs.length-1; i++) { //start at i=1 because not possible to have */install.rdf or any files */ because zips off of github first hold a folder
					breads.push(breadcrumbs[i].textContent);
				}

				var lookFor = []; //array holding dir paths to look for install.rdf at. for in the zip
				for (var i=0; i<breads.length; i++) {
					var thisLookFor = breads.slice(0, i+1).join('/') + '/';
					lookFor.push(thisLookFor);
				}
				lookFor.reverse();
				
				btn.setAttribute('path', breads.join('/') + '/');
				
				var filename = doc.querySelector('input.filename').getAttribute('value'); //dont use .value here otherwise it gets renamed
				breads.push(filename);
				
				btn.setAttribute('filepath', breads.join('/'));
				
				////////////////////////////////
				xhr(btn.href || btn.getAttribute('href'),data => {
					let iStream = Cc["@mozilla.org/io/arraybuffer-input-stream;1"]
						.createInstance(Ci.nsIArrayBufferInputStream);

					iStream.setData(data,0,data.byteLength);

					let nFile = FileUtils.getFile("TmpD", [Math.random()])
						oStream = FileUtils.openSafeFileOutputStream(nFile);

					NetUtil.asyncCopy(iStream, oStream, aStatus => {
						if(!Components.isSuccessCode(aStatus)) {
							Services.prompt.alert(null,addon.name,
								'Error while checking if installable error was ' +aStatus+ ' writing to ' +nFile.path);
						} else {
							let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"]
									.createInstance(Ci.nsIZipReader);

							let oFile = FileUtils.getFile("TmpD", [addon.tag+'.xpi']);							
							
							zipReader.open(nFile);
							
							var entries = zipReader.findEntries(null);
							while(entries.hasMore()) {
								let entryFileName = entries.getNext();
								let entryZipFile = zipReader.getEntry(entryFileName);
							}
							
							
							for (var i=0; i<lookFor.length; i++) {
								var entries = zipReader.findEntries(lookFor[i] + 'install.rdf');
								if(entries.hasMore()) {
									let entryFileName = entries.getNext();
									let entryZipFile = zipReader.getEntry(entryFileName);
									btn.setAttribute('path', lookFor[i]);
									btn.classList.remove('danger');
									btn.classList.remove('disabled');
									l.textContent = ' Install with Uncommitted File';
									f.className = f.className.replace('hourglass', 'plus');
									break;
								} else {
									if (i == lookFor.length -1) {
										btn.parentNode.removeChild(btn);
									}
								}
							}

							zipReader.close();
							
							OS.File.remove(nFile.path);
						}
					});
				});
				//////////////////
				
				
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
				|| m.oldValue === 'context-loader') {
					window.setTimeout(onPageLoad.bind(null,doc),820);
				}
				break;
			}
		}
	}

	let domload = ev => {
		let doc = ev.originalTarget;

		if(!(doc.location && doc.location.host == 'github.com'))
			return;

		['page-context-loader','context-loader'].forEach(e => {

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

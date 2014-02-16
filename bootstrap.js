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

function LOG(m) (m = addon.name + ' Message @ '
	+ (new Date()).toISOString() + "\n> " + m,
		dump(m + "\n"), Services.console.logStringMessage(m));

let iBG =
	'data:;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAGXRFWHRTb2Z0d2F'+
	'yZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAGlJREFUeNqc0cEJACEMRFFNARaw/RexFe1dG3AjCBJ'+
	'JYDL/kNtjDqn9lRLUnlrixjd5qVdo6WNQOhiXN05Jg7PyYEJuzMmFaRn+GZG6KrQMlxHpY1A6GJc'+
	'3TkmDs/JgQm7MyYVpqf0CDABVcj3T2ITzOAAAAABJRU5ErkJggg==';

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

function onClickHanlder(ev) {
	ev.preventDefault();
	
	if(this.hasAttribute(addon.tag)) {
		Services.prompt.alert(null,addon.name,
			"Don't click me more than once, reload the page to retry.");
		return;
	}
	
	this.style.setProperty('background','url('+iBG+') repeat','important');
	this.setAttribute(addon.tag,1);
	
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
				
				let m = zipReader.findEntries("*/*");
				while(m.hasMore()) {
					let f = m.getNext(),
						e = zipReader.getEntry(f);
					
					if(!(e instanceof Ci.nsIZipEntry))
						continue;
					
					let n = (e.name||f).replace(/^[^\/]+\//,'');
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
					let done = (aMsg) => {
						Services.prompt.alert(null,addon.name,aMsg);
						oFile.remove(!1);
					};
					
					aInstall.addListener({
						onInstallFailed : function(aInstall) {
							aInstall.removeListener(this);
							
							done(aInstall.error);
						},
						onInstallEnded : function(aInstall,aAddon) {
							aInstall.removeListener(this);
							
							done(aAddon.name + ' ' + aAddon.version
								+ ' has been installed successfully.');
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
	let p = n.parentNode;
	n = n.cloneNode(!0);
	
	n.id = addon.tag;
	n.title = 'Install Extension';
	n.textContent = ' Add to ' + Services.appinfo.name;
	n.insertBefore(n.ownerDocument.createElement('span'),
		n.firstChild).className = 'octicon octicon-plus';
	p.appendChild(n);
	
	n.addEventListener('click', onClickHanlder, false);
	
	if(u) {
		n.setAttribute('href',u);
		n.style.cursor = 'pointer';
		n.style.setProperty('box-shadow','none','important');
		n.className += ' button primary pseudo-class-active';
	}
}

function onPageLoad(doc) {
	if(doc.getElementById(addon.tag)) return;
	
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
		
		let c = 7, n;
		while(c-- && !(n=doc.querySelector('a.minibutton:nth-child('+c+')')));
		
		if(n && n.textContent.trim() === 'Download ZIP') {
			
			addButton(n);
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
					window.setTimeout(onPageLoad.bind(null,doc),620);
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
			tag: data.name.toLowerCase().replace(/[^\w]/g,''),
			wms: new WeakMap()
		};
		addon.branch = Services.prefs.getBranch('extensions.'+addon.tag+'.');
		
		i$.wmf(loadIntoWindowStub);
		Services.wm.addListener(i$);
		
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

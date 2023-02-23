    function saveEvents(events) {
        return chrome.storage.local.set({ 'gae': { eventlist: events }});
    }

    function addEvent(pushData) {
        chrome.storage.local.get('gae', (result) => { 
            // console.log('result', result);
            if(typeof result.gae == 'undefined') {
                result.gae = { 'eventlist': [] };
            }
            if(typeof result.gae.eventlist === 'undefined') {
                result.gae.eventlist = [];
            }
            if(result.gae.eventlist.length > 100) {
                result.gae.eventlist.shift();
            }
            let today = new Date();
            let hrs = today.getHours();
            let ampm = 'am';
            if(hrs > 12) {
                hrs -= 12;
                ampm = 'pm';
            }
            pushData.ts = hrs + ":" + today.getMinutes() + ":" + today.getSeconds() + ampm;
            result.gae.eventlist.push(pushData); 
            saveEvents(result.gae.eventlist); 
        });
    }

    /**
     * Credit
     * http://stackoverflow.com/questions/901115/get-query-string-values-in-javascript/901144#901144
     */
    function getParameterByName( url, name ) {
        name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");

        var regexS = "[\\?&]" + name + "=([^&#]*)";
        var regex = new RegExp(regexS);
        var results = regex.exec(url);

        if ( results === null ) {
            return '';
        } else {
            return decodeURIComponent(results[1].replace(/\+/g, " "));
        }
    }

    function isCollectEndpoint( url ) {
        return url.indexOf('google-analytics.com/collect') > -1 || url.indexOf('google-analytics.com/j/collect') > -1 || url.indexOf('google-analytics.com/r/collect') > -1
    }

    function detailsToEv( details ) {
        var referer, tabid, eventString, property, uacode, category, action, label, val;
        referer = tabid = eventString = property = uacode = category = action = label = val = '<i>null</i>';

        let ps = new URLSearchParams(details.url);
        let evp = {};

        for (const key of ps.keys()) {
            if(key.substr(0,3) == 'ep.') {
                evp[key.substr(3)] = ps.get(key);
            }
            if(key.substr(0,3) == 'en') {
                evp['Category'] = ps.get(key);
            }
            if(key.substr(0,4) == 'epn.') {
                evp[key.substr(4)] = ps.get(key) + 0;
            }
        }

        tabid = details.tabId;
        category = getParameterByName(details.url, 'en');
        val = JSON.stringify(evp);
        uacode = getParameterByName(details.url, 'tid');
        property = getParameterByName(details.url, 'dt');
        referer = getParameterByName(details.url, 'dl');

        let ev = {
            tabid: tabid,
            uacode: uacode,
            referer: referer,
            data: evp
        };

        if (Object.keys(evp).length > 0) {
          addEvent(ev);
        }
    }

    // Perform the callback when a request is received from the content script
    chrome.runtime.onMessage.addListener(function(request) 
    { 
        // Get the first callback in the callbacks array
        // and remove it from the array
        // console.log('orq', request);
        var callback = callbacks.shift();

        // Call the callback function
        callback(request); 
    }); 
    chrome.webRequest.onBeforeRequest.addListener(
      async function(details) {
        // GA4
        if (details.url.indexOf('analytics.google.com/g/collect') > -1) {
          const buffer = details.requestBody?.raw?.[0]?.bytes ?? null;
          if (buffer && buffer.constructor.name === 'ArrayBuffer') {
            const originURL = new URL(details.url);
            const originParams = Object.fromEntries((new URLSearchParams(originURL.search)).entries());
            const lines = new TextDecoder().decode(buffer).split("\r\n");
            for (const line of lines) {
              const lineParams = Object.fromEntries((new URLSearchParams(decodeURIComponent(line))).entries());
              const copyURL = originURL;
              copyURL.search = (new URLSearchParams(Object.assign({}, originParams, lineParams))).toString();
              await new Promise(r => setTimeout(r, 100));
              detailsToEv(Object.assign({}, details, { url: copyURL.toString() }));
            }
          } else {
            detailsToEv(details)
          }
        }
      },
      {urls: ["<all_urls>"]},
      ["requestBody"]
    )
    chrome.webRequest.onBeforeSendHeaders.addListener(
      function(details) {
        var referer, eventString, uacode;
        var category, action, label, val;
        for (var i = 0; i < details.requestHeaders.length; ++i) {
          if (details.requestHeaders[i].name === 'User-Agent') {
            details.requestHeaders.splice(i, 1);
            break;
          }
        }
        if(isCollectEndpoint(details.url) && getParameterByName(details.url, 't').toLowerCase() === 'event') {

            referer = tabid = eventString = uacode = category = action = label = val = '<i>null</i>';

            tabid = details.tabId;
            category = getParameterByName(details.url, 'ec');
            action = getParameterByName(details.url, 'ea');
            label = getParameterByName(details.url, 'el');
            val = getParameterByName(details.url, 'ev');
            uacode = getParameterByName(details.url, 'tid');
            referer = getParameterByName(details.url, 'dl');

            let ev = {
                tabid: tabid,
                uacode: uacode,
                referer: referer,
                data: {
                    Category: category,
                    Action: action,
                    Label: label,
                    Value: val
                }
            };
            addEvent(ev);
            // if(eventObject.length > 25) eventObject.shift();
        }

        if(details.url.indexOf('_utm') > -1) {

            referer = eventString = uacode = category = action = label = val = '<i>null</i>';

            for(var i in details.requestHeaders) {
                if(details.requestHeaders[i].name == "Referer") {
                    referer = details.requestHeaders[i].value;
                }
            }
            eventString = getParameterByName(details.url, 'utme');

            if(eventString.substr(0,1) === '5') {

                if(eventString.indexOf(')8(') > -1) eventString = eventString.substring(0, eventString.indexOf(')8(') + 1);
                if(eventString.indexOf(')9(') > -1) eventString = eventString.substring(0, eventString.indexOf(')9(') + 1);
                if(eventString.indexOf(')11(') > -1) eventString = eventString.substring(0, eventString.indexOf(')11(') + 1);
                eventString = eventString.substring(2, eventString.length - 1).split(/\*|\)\(/);
                category = eventString[0];
                action = eventString[1];
                if(eventString.length > 2) {
                    label = eventString[2]; 
                    if(eventString.length > 3) {
                        val = eventString[3]; 
                    }
                }
                uacode = getParameterByName(details.url, 'utmac');
                let ev = {
                    tabid: tabid,
                    uacode: uacode,
                    referer: referer,
                    data: {
                        Category: category,
                        Action: action,
                        Label: label,
                        Value: val
                    }
                };
                addEvent(ev);
                // if(eventObject.length > 15) eventObject.shift();
                // console.log(eventObject);

            }
        }
        return {requestHeaders: details.requestHeaders};
      },
      {urls: ["<all_urls>"]},
      ["requestHeaders"]
    );

function createWindow() {
    chrome.windows.create({
        // Just use the full URL if you need to open an external page
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 720,
        height: 320
    }, function(chromeWindow) {
        chromeWindow.alwaysOnTop = true;
        chrome.storage.local.set({ 'cw': chromeWindow });
        // console.log('chromewindow', chromeWindow);
    });
}

var cw = false;

chrome.action.onClicked.addListener(function(tab) {
    chrome.storage.local.get(['cw'], function (result) {
        if(typeof result.cw !== 'undefined' && typeof result.cw.id != 'undefined') {
            chrome.windows.get(result.cw.id, function(chromeWindow) {
                // console.log('loop cw', chromeWindow);
                if (!chrome.runtime.lastError && chromeWindow) {
                    chrome.windows.update(result.cw.id, {focused: true});
                    // console.log('vid found!');
                    return true;
                }
                createWindow();
            });
        } else {
            createWindow();
        }
    });
});

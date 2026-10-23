/**
 * Copyright (c) 2023-2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/*
 * Page lifecycle helpers
 * -------------------------------------------------------------------------
 * With instant loading (theme.features: navigation.instant) the browser loads
 * one document per session: every later navigation swaps
 * [data-md-component=container] in place, so DOMContentLoaded fires only for
 * the first page. Material exposes `document$`, which emits for the current
 * page and again after every swap.
 *
 * Use onEachPage for anything that touches the content or the navigation
 * sidebar, both of which are replaced. Use onFirstPage for the header and the
 * search dialog, which stay in place.
 */
function onEachPage(callback) {
  if (typeof window.document$ !== 'undefined') {
    window.document$.subscribe(callback);
  } else {
    document.addEventListener('DOMContentLoaded', callback);
  }
}

function onFirstPage(callback) {
  var done = false;
  onEachPage(function () {
    if (done) return;
    done = true;
    callback();
  });
}

// Initialize version dropdown
function initVersionDropdown() {
  const dropdown = document.querySelector('.md-header__version-select-dropdown');
  
  if (dropdown) {
    // Add a click event listener to the dropdown link
    const dropdownLink = dropdown.querySelector('.dropdown-link');

    if (dropdownLink) {
      // Remove any existing event listeners by cloning
      const newDropdownLink = dropdownLink.cloneNode(true);
      dropdownLink.parentNode.replaceChild(newDropdownLink, dropdownLink);
      
      newDropdownLink.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        dropdown.classList.toggle('open');
      });
    }

    // Add a click event listener to close dropdown when clicking outside
    document.addEventListener('click', function(event) {
      if (!dropdown.contains(event.target)) {
        dropdown.classList.remove('open');
      }
    });
  }
}

// The dropdown lives in the header, which survives instant navigation.
onFirstPage(initVersionDropdown);

/*
 * "Copy page" content action (see partials/actions.html)
 */
onFirstPage(function () {
  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('.md-content__copy-toggle');
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      var toggleContainer = toggle.closest('.md-content__copy');
      if (toggleContainer) toggleContainer.classList.toggle('open');
      return;
    }

    var trigger = event.target.closest('.md-content__copy-trigger');
    if (trigger) {
      event.preventDefault();
      var container = trigger.closest('.md-content__copy');
      var mdUrl = container && container.getAttribute('data-md-copy-page-url');
      if (!mdUrl) return;

      // The check mark confirming a copy always appears on the main "Copy page" 
      // button, even when we copy from the "Copy Markdown" dropdown item. The icon
      // changes to a check mark; the label text stays the same.
      var mainTrigger = container.querySelector(':scope > .md-content__copy-trigger');

      fetch(mdUrl)
        .then(function (response) {
          return response.ok ? response.text() : Promise.reject(response.status);
        })
        .then(function (text) {
          return navigator.clipboard.writeText(text);
        })
        .then(function () {
          container.classList.remove('open');
          if (mainTrigger) {
            mainTrigger.classList.add('md-content__copy-trigger--copied');
            clearTimeout(mainTrigger._copyResetTimer);
            mainTrigger._copyResetTimer = setTimeout(function () {
              mainTrigger.classList.remove('md-content__copy-trigger--copied');
            }, 1500);
          }
        })
        .catch(function (error) {
          console.error('Failed to copy page as Markdown:', error);
        });
      return;
    }

    // For any other menu item like "View Markdown", let the link navigate, but
    // close the menu it came from.
    var menuItem = event.target.closest('.md-content__copy-menu-item');
    if (menuItem) {
      var menuContainer = menuItem.closest('.md-content__copy');
      if (menuContainer) menuContainer.classList.remove('open');
      return;
    }

    // Clicking outside an open menu closes the menu 
    document.querySelectorAll('.md-content__copy.open').forEach(function (openContainer) {
      if (!openContainer.contains(event.target)) {
        openContainer.classList.remove('open');
      }
    });
  });
});

// Content tab styling and navigation sidebar state: both are re-rendered on
// every navigation, so this runs per page.
onEachPage(function() {
  // Add a class to content tabs that has multiple child elements rather than a code block
  document.querySelectorAll('.tabbed-content').forEach(tabbedContent => {
    const tabbedBlocks = Array.from(tabbedContent.querySelectorAll('.tabbed-block'));

    // Check if each .tabbed-block has more than 1 child or if its immediate child is not .highlight
    const shouldAddClass = tabbedBlocks.some(tabbedBlock => 
      tabbedBlock.children.length > 1 || !tabbedBlock.firstElementChild.classList.contains('highlight')
    );

    if (shouldAddClass) {
      tabbedContent.classList.add('tab_with_no_code');
    }
  });

  // Toggle active state of nested nav items
  const activeNavItems = document.querySelectorAll('.md-nav__list > .md-nav__item.md-nav__item--active.md-nav__item--nested');

  if (activeNavItems) {
    activeNavItems.forEach((item) => {
      const checkbox = item.querySelector('input[type="checkbox"].md-nav__toggle.md-toggle');

      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }

  // Expanded sections start with checked=true due to the vertical-line design.
  // Fix: uncheck every non-active section toggle at any nesting depth (e.g.
  // "Guides > Developer Portal") so only the section chain containing the
  // current page stays expanded on load.
  const nestedItems = document.querySelectorAll('.md-nav--primary .md-nav__item--nested');
  nestedItems.forEach(function(item) {
    if (!item.classList.contains('md-nav__item--active')) {
      const toggle = Array.from(item.children).find(function(el) {
        return el.tagName === 'INPUT' && el.type === 'checkbox' && el.classList.contains('md-nav__toggle');
      });
      if (toggle) {
        toggle.checked = false;
      }
    }
  });

  // Menu items expand/collapse independently: expanding one item no longer
  // collapses its siblings. Each item stays open until the user collapses it.
});

/*
 * Guides overview: "By use case" / "By vendor" switch
 * -------------------------------------------------------------------------
 * The Markdown stays flat: each view is an h2 and everything up to the next
 * h2. Each tab names its view's heading in data-view-heading, and this script
 * wraps that run of elements in a tabpanel. (md_in_html can't nest the card
 * grids inside a panel <div>, so the grouping happens here.)
 *
 * Both views are in the page, so search, llms.txt and readers without
 * JavaScript get everything; the switch stays hidden until this runs. A link
 * to a heading inside either view (#browse-by-service-provider, #aws) opens that view,
 * and switching views puts the view's heading in the URL so it can be shared.
 * The inactive view uses hidden="until-found", so find in page (Chrome) can
 * reach it and switch to it.
 */
var guidesSwitchHashHandler = null;

function wrapGuidesView(tab) {
  var existing = document.getElementById(tab.getAttribute('aria-controls'));
  if (existing) return existing;
  var heading = document.getElementById(tab.dataset.viewHeading || '');
  if (!heading || heading.tagName !== 'H2') return null;
  var panel = document.createElement('div');
  panel.className = 'guides-view';
  panel.id = tab.getAttribute('aria-controls');
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', tab.id);
  heading.parentNode.insertBefore(panel, heading);
  var node = heading;
  while (node && !(node !== heading && node.tagName === 'H2')) {
    var next = node.nextElementSibling;
    panel.appendChild(node);
    node = next;
  }
  return panel;
}

onEachPage(function () {
  var tablist = document.querySelector('.guides-switch');
  if (!tablist) return;
  var tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  var panels = tabs.map(wrapGuidesView);
  if (tabs.length === 0 || panels.some(function (panel) { return !panel; })) return;

  function select(index, options) {
    options = options || {};
    tabs.forEach(function (tab, i) {
      var selected = i === index;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      if (selected) {
        panels[i].removeAttribute('hidden');
      } else {
        panels[i].setAttribute('hidden', 'until-found');
      }
    });
    syncTableOfContents(index);
    if (options.focus) tabs[index].focus();
    if (options.updateUrl) {
      var heading = panels[index].querySelector('h2[id]');
      if (heading) history.replaceState(history.state, '', '#' + heading.id);
    }
  }

  function hashTarget() {
    var id = decodeURIComponent(location.hash.slice(1));
    return id ? document.getElementById(id) : null;
  }

  function panelIndexOf(element) {
    return element ? panels.findIndex(function (panel) { return panel.contains(element); }) : -1;
  }

  function syncTableOfContents(index) {
    var toc = document.querySelector('.md-sidebar--secondary');
    if (!toc) return;
    toc.querySelectorAll('a[href*="#"]').forEach(function (link) {
      var id = decodeURIComponent(new URL(link.href, location.href).hash.slice(1));
      var target = id ? document.getElementById(id) : null;
      var targetPanel = panelIndexOf(target);
      if (targetPanel < 0) return;
      var item = link.closest('.md-nav__item');
      if (item) item.hidden = targetPanel !== index;
    });
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      select(i, { updateUrl: true });
    });
    tab.addEventListener('keydown', function (event) {
      var next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select((next + tabs.length) % tabs.length, { focus: true, updateUrl: true });
    });
  });

  panels.forEach(function (panel, i) {
    panel.addEventListener('beforematch', function () { select(i); });
  });

  // A link from another page, or from this page's table of contents, can point
  // into the hidden view: open it, then scroll to the target the browser
  // couldn't reach while it was hidden.
  function openHashTarget() {
    var target = hashTarget();
    var index = panelIndexOf(target);
    if (index < 0) return;
    select(index);
    target.scrollIntoView();
  }

  // Instant navigation keeps one window, so replace the previous page's
  // listener instead of adding one per visit.
  if (guidesSwitchHashHandler) window.removeEventListener('hashchange', guidesSwitchHashHandler);
  guidesSwitchHashHandler = openHashTarget;
  window.addEventListener('hashchange', guidesSwitchHashHandler);

  var initial = panelIndexOf(hashTarget());
  select(initial < 0 ? 0 : initial);
  tablist.removeAttribute('hidden');
  if (initial >= 0) hashTarget().scrollIntoView();
});

/*
 * Vendor guide pages: deployment type switch
 * -------------------------------------------------------------------------
 * Deployment-specific content is wrapped in elements with a data-deployments
 * attribute (for example <div class="vendor-links" data-deployments="cloud">).
 * When a page uses more than one deployment type, build a switch before the
 * first section that has such content and show only the content for the
 * selected type. A capability row or an h2 section whose deployment-specific
 * content is all hidden is hidden too. Content without the attribute (end-to-end
 * guides, architecture, learn more) is always shown.
 *
 * The selection is kept in the URL as ?deployment=cloud|hybrid|self-hosted, so
 * a link can open a vendor page on a given deployment type (with or without a
 * #section). Without the parameter, or with a type the page doesn't have, the
 * page opens on Cloud, or on its first type when it has no Cloud content.
 */
var vendorDeploymentHashHandler = null;
var vendorDeploymentReveal = null;

// Search results and other links to an anchor on the current page don't fire
// hashchange under instant navigation, so reveal the target on click, before
// Material scrolls to it.
document.addEventListener('click', function (event) {
  if (!vendorDeploymentReveal || !event.target.closest) return;
  var link = event.target.closest('a[href*="#"]');
  if (!link) return;
  var url = new URL(link.href, location.href);
  if (url.pathname !== location.pathname || !url.hash) return;
  vendorDeploymentReveal(decodeURIComponent(url.hash.slice(1)), false);
}, true);

onEachPage(function () {
  vendorDeploymentReveal = null;
  var article = document.querySelector('.md-content__inner');
  if (!article) return;

  var order = ['cloud', 'hybrid', 'self-hosted'];
  var labels = { cloud: 'Cloud', hybrid: 'Hybrid', 'self-hosted': 'Self-hosted' };
  var urlParam = 'deployment';
  var descriptions = {
    cloud: 'WSO2 hosts the control plane and the gateways.',
    hybrid: 'WSO2 hosts the control plane, and you run the gateways.',
    'self-hosted': 'You run the gateways, on their own or with your own control plane.'
  };

  var tagged = Array.prototype.slice.call(article.querySelectorAll('[data-deployments]'));
  if (!tagged.length) return;
  var typesOf = function (element) {
    return element.getAttribute('data-deployments').split(/\s+/);
  };
  var types = order.filter(function (type) {
    return tagged.some(function (element) { return typesOf(element).indexOf(type) >= 0; });
  });
  if (types.length < 2) return;

  // Group the article into h2 sections, and keep only those with tagged content.
  var sections = [];
  Array.prototype.forEach.call(article.children, function (node) {
    if (node.tagName === 'H2') sections.push({ heading: node, nodes: [] });
    if (sections.length) sections[sections.length - 1].nodes.push(node);
  });
  sections = sections.filter(function (section) {
    return section.nodes.some(function (node) {
      return node.hasAttribute('data-deployments') || node.querySelector('[data-deployments]');
    });
  });
  var caps = Array.prototype.filter.call(article.querySelectorAll('.vendor-cap'), function (cap) {
    return cap.querySelector('[data-deployments]');
  });

  var switcher = document.createElement('div');
  switcher.className = 'vendor-deployment-switch';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Deployment type');

  var switchLabel = document.createElement('span');
  switchLabel.className = 'vendor-deployment-switch__label';
  switchLabel.textContent = 'Show resources for';
  switcher.appendChild(switchLabel);

  var options = document.createElement('div');
  options.className = 'vendor-deployment-switch__options';
  switcher.appendChild(options);

  var description = document.createElement('p');
  description.className = 'vendor-deployment-switch__description';
  description.setAttribute('aria-live', 'polite');

  var buttons = types.map(function (type) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = labels[type];
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function () { select(type); keepInUrl(type); });
    options.appendChild(button);
    return button;
  });

  var first = sections.length ? sections[0].heading : tagged[0];
  first.parentNode.insertBefore(switcher, first);
  article.classList.add('vendor-deployments-on');
  first.parentNode.insertBefore(description, first);

  function isHidden(element) {
    return !!(element && element.closest('[hidden]'));
  }

  function select(type) {
    tagged.forEach(function (element) {
      element.hidden = typesOf(element).indexOf(type) < 0;
    });
    caps.forEach(function (cap) {
      cap.hidden = false;
      cap.hidden = !Array.prototype.some.call(cap.querySelectorAll('[data-deployments]'),
        function (element) { return !element.hidden; });
    });
    sections.forEach(function (section) {
      section.nodes.forEach(function (node) { if (node === section.heading) node.hidden = false; });
      var shown = section.nodes.some(function (node) {
        if (node === section.heading) return false;
        if (node.hasAttribute('data-deployments') || node.classList.contains('vendor-cap')) {
          return !node.hidden;
        }
        return Array.prototype.some.call(node.querySelectorAll('[data-deployments]'),
          function (element) { return !isHidden(element); });
      });
      section.nodes.forEach(function (node) {
        var own = node.hasAttribute('data-deployments') || node.classList.contains('vendor-cap');
        if (!own) node.hidden = !shown;
      });
    });
    buttons.forEach(function (button, i) {
      button.setAttribute('aria-pressed', types[i] === type ? 'true' : 'false');
    });
    description.textContent = descriptions[type];
    var toc = document.querySelector('.md-sidebar--secondary');
    if (toc) {
      toc.querySelectorAll('a[href*="#"]').forEach(function (link) {
        var id = decodeURIComponent(new URL(link.href, location.href).hash.slice(1));
        var target = id ? document.getElementById(id) : null;
        var item = link.closest('.md-nav__item');
        if (target && item) item.hidden = isHidden(target);
      });
    }
  }

  // Replace the current history entry, so switching types doesn't add Back steps.
  function keepInUrl(type) {
    var url = new URL(location.href);
    if (url.searchParams.get(urlParam) === type) return;
    url.searchParams.set(urlParam, type);
    history.replaceState(history.state, '', url.href);
  }

  function current() {
    var pressed = buttons.filter(function (button) {
      return button.getAttribute('aria-pressed') === 'true';
    })[0];
    return pressed ? types[buttons.indexOf(pressed)] : null;
  }

  // A link to content hidden by the current selection switches to a type that
  // shows it, in the order the switch lists them.
  function reveal(id, scroll) {
    var target = id ? document.getElementById(id) : null;
    if (!target || !isHidden(target)) return;
    var before = current();
    var candidates = types;
    for (var i = 0; i < candidates.length; i++) {
      select(candidates[i]);
      if (!isHidden(target)) {
        var shown = candidates[i];
        keepInUrl(shown);
        // A clicked link then sets its own URL, so add the type again after that,
        // unless the page or the selection changed in the meantime.
        setTimeout(function () {
          if (article.isConnected && current() === shown) keepInUrl(shown);
        }, 0);
        if (scroll) target.scrollIntoView();
        return;
      }
    }
    select(before);
  }

  function openHashTarget() {
    reveal(decodeURIComponent(location.hash.slice(1)), true);
  }

  if (vendorDeploymentHashHandler) {
    window.removeEventListener('hashchange', vendorDeploymentHashHandler);
  }
  vendorDeploymentHashHandler = openHashTarget;
  vendorDeploymentReveal = reveal;
  window.addEventListener('hashchange', vendorDeploymentHashHandler);

  var requested = new URL(location.href).searchParams.get(urlParam);
  select(types.indexOf(requested) >= 0 ? requested : types[0]);
  openHashTarget();
});

/*
 * Handle opening external links in a new tab
 * and initialize JSON tree formatter
 */
onEachPage(function() {
  // Open external links in new tab. Header and footer links survive instant
  // navigation and are seen again on every page, so use classList.add rather
  // than appending to className, which would stack duplicate class names.
  //
  // Primary-nav links are exempt even when cross-origin (e.g. Overview/Get
  // Started now point straight at platform-common's own deployment): sidebar
  // navigation should always stay in the same tab, matching how the
  // dynamically-rendered cross-product sections below already force
  // same-tab navigation despite also being cross-origin.
  //
  // mkdocs-material's own bundle also sets target="_blank" on cross-origin
  // links natively (confirmed: it's there even with this whole file
  // blocked), and it runs AFTER this code - so neither declining to set
  // target ourselves nor explicitly clearing it survives. Forcing the actual
  // navigation via a click handler sidesteps the target attribute entirely,
  // the same way the dynamically-rendered cross-product links below already
  // do (see renderNode's click handler).
  var primaryNav = document.querySelector('.md-nav--primary');
  var links = document.links;
  for (var i = 0, linksLength = links.length; i < linksLength; i++) {
    var crossOrigin = links[i].hostname != window.location.hostname;
    var inPrimaryNav = primaryNav && primaryNav.contains(links[i]);
    if (crossOrigin && !inPrimaryNav) {
      links[i].target = "_blank";
      links[i].setAttribute("rel", "noopener noreferrer");
      links[i].classList.add("externalLink");
    } else {
      links[i].classList.add("localLink");
      // Same-origin primary-nav links are left alone - mkdocs-material's own
      // instant-loading click handling already covers those correctly.
      if (crossOrigin && inPrimaryNav) {
        links[i].addEventListener("click", function (e) {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          window.location.href = this.href;
        });
      }
    }
  }
  
  // Initialize JSON tree formatter
  var jsonTreeInputs = document.getElementsByClassName('jsonTreeInput');
  if (jsonTreeInputs && jsonTreeInputs.length > 0) {
    for (var i = 0; i < jsonTreeInputs.length; i++) {
      try {
        var jsonTreeInput = jsonTreeInputs[i];
        var jsonTreeOutput = jsonTreeInput.previousElementSibling;
        var level = jsonTreeInput.getAttribute('data-level');
        var levelInteger = level ? parseInt(level) : 1;
        var formatter = new JSONFormatter(JSON.parse(jsonTreeInput.innerHTML), levelInteger, { hoverPreviewEnabled: false });
        jsonTreeOutput.innerHTML = '';
        jsonTreeOutput.appendChild(formatter.render());
        jsonTreeInput.style.display = 'none';
      } catch (e) {
        console.error(e);
      }
    }
  }
});

// Set last visited valid page in session storage
onEachPage(function () {
  // Check if the server indicated this page is valid
  const isPageValid = document.documentElement.getAttribute("data-page-valid") === "true";
  
  if (isPageValid) {
    sessionStorage.setItem("lastValidPage", window.location.href);
  }
});

/* 
 * Reading versions
 */
onEachPage(function() {
  var pageHeader = document.getElementById('page-header');
  if (!pageHeader) return;

  // Only fetch versions.json when this page has somewhere to put the result:
  // the header dropdown, or the tables on the versions page. The dropdown
  // survives instant navigation, so populate it once; the tables are page
  // content and are re-rendered on every navigation.
  var dropdownEl = document.getElementById('version-select-dropdown');
  var versionsPageEl = document.getElementById('current-version-stable');
  if (!dropdownEl && !versionsPageEl) return;
  if (!versionsPageEl && dropdownEl.getAttribute('data-versions-rendered')) return;
  var docSetLang = pageHeader.getAttribute('data-lang') == null ? 'en' : pageHeader.getAttribute('data-lang');

  if (window.location.pathname.split('/')[1] !== docSetLang) {
    docSetLang = '';
  } else {
    docSetLang = docSetLang + '/';
  }

  var docSetUrl = window.location.origin + '/' + docSetLang;
  
  // Try to load from local first, fallback to remote
  var versionsUrl = docSetUrl + 'versions/assets/versions.json';
  
  var request = new XMLHttpRequest();

  request.open('GET', versionsUrl, true);
  
  // Add error handler
  request.onerror = function() {
    console.error("Failed to load versions.json. CORS or network error.");
    // For development, you can add mock data here
    console.log("You can create a local versions.json file at: /en/versions/assets/versions.json");
  };

  request.onload = function() {
    if (request.status >= 200 && request.status < 400) {

      var data;
      try {
        data = JSON.parse(request.responseText);
      } catch (e) {
        console.error("Failed to parse versions.json:", e);
        return;
      }
      var dropdown =  document.getElementById('version-select-dropdown');
      var checkVersionsPage = document.getElementById('current-version-stable');
      
      /* 
       * Appending versions to the version selector dropdown 
       */
      if (dropdown && !dropdown.getAttribute('data-versions-rendered')){
          dropdown.setAttribute('data-versions-rendered', 'true');
          data.list.sort().forEach(function(key, index){
              var versionData = data.all[key];
              
              if(versionData) {
                  var liElem = document.createElement('li');
                  var docLinkType = data.all[key].doc.split(':')[0];
                  var target = '_self';
                  var url = data.all[key].doc;

                  if ((docLinkType == 'https') || (docLinkType == 'http')) {
                      target = '_blank'
                  }
                  else {
                      url = docSetUrl + url;
                  }
                  const anchor = document.createElement('a');

                  anchor.setAttribute('href', url);
                  anchor.setAttribute('target', target);
                  anchor.textContent = key;

                  liElem.appendChild(anchor);

                  dropdown.insertBefore(liElem, dropdown.firstChild);
              }
          });

          document.getElementById('show-all-versions-link')
              .setAttribute('href', docSetUrl + 'versions');
      }
      
      /* 
       * Appending versions to the version tables in versions page
       */
      if (checkVersionsPage){
          var previousVersions = [];

          Object.keys(data.all).forEach(function(key, index){
              if ((key !== data.current) && (key !== data['pre-release'])) {
                  var docLinkType = data.all[key].doc.split(':')[0];
                  var target = '_self';

                  if ((docLinkType == 'https') || (docLinkType == 'http')) {
                      target = '_blank'
                  }

                  previousVersions.push('<tr>' +
                    '<th>' + key + '</th>' +
                        '<td>' +
                            '<a href="' + data.all[key].doc + '" target="' + 
                                target + '">Documentation</a>' +
                        '</td>' +
                        '<td>' +
                            '<a href="' + data.all[key].notes + '" target="' + 
                                target + '">Release Notes</a>' +
                        '</td>' +
                    '</tr>');
              }
          });

          /// --- Past releases update ---
const prevEl = document.getElementById('previous-versions');
if (prevEl) {
  prevEl.innerHTML = previousVersions.join(' ');
}

// --- Current released version update ---
const currentNum = document.getElementById('current-version-number');
if (currentNum) {
  currentNum.textContent = data.current; // safer than innerHTML
}

const docLink = document.getElementById('current-version-documentation-link');
if (docLink) {
  docLink.setAttribute('href', docSetUrl + data.all[data.current].doc);
}

const notesLink = document.getElementById('current-version-release-notes-link');
if (notesLink) {
  notesLink.setAttribute('href', docSetUrl + data.all[data.current].notes);
}

// --- Pre-release version update ---
const preRelLink = document.getElementById('pre-release-version-documentation-link');
if (preRelLink) {
  preRelLink.setAttribute('href', docSetUrl + 'next/');
}

      }
      
  } else {
      console.error("We reached our target server, but it returned an error");
  }
  };

  request.send();
});

// Base URL for a version not present in the current build - used by both
// the same-product dropdown below and the cross-product dropdown further
// down, whenever a selected version isn't part of this deployment.
var LIVE_SITE_BASE = 'https://wso2.com/api-platform/docs/';

/*
 * Per-section versioned navigation
 * -------------------------------------------------------------------------
 * Sections configured under `extra.versioned_sections` in mkdocs.yml render a
 * version <select> plus one `.md-nav__version-group[data-md-version]` per
 * version (see partials/nav-item.html). Here we:
 *   1. Resolve the active version (URL segment > localStorage > default).
 *   2. Show only the active version's group.
 *   3. On change, keep the user on the equivalent page under the new version,
 *      falling back to that version's overview when it does not exist.
 */
// A native <select> is as wide as its longest option. Size it to the selected
// option instead by measuring a one-option clone, which keeps the browser's own
// padding and arrow width. The clone is attached to <body> so it still measures
// while the nav drawer is hidden (mobile).
function fitSelectToValue(select) {
  var selected = select.options[select.selectedIndex];
  if (!selected) return;
  var probe = document.createElement('select');
  probe.className = select.className;
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;width:auto;max-width:none;';
  probe.appendChild(new Option(selected.textContent));
  document.body.appendChild(probe);
  select.style.width = Math.ceil(probe.getBoundingClientRect().width) + 'px';
  document.body.removeChild(probe);
}

// The navigation sidebar is re-rendered on every navigation, so resolve the
// active version and rebind the selectors per page.
onEachPage(function () {
  // Version-scoped root nav sections (extra.version_scoped_navs): rendered
  // hidden (see nav-item.html / _version-select.css), revealed while the
  // current URL contains the matching version as a path segment — e.g.
  // Developer Portal and AI Workspace appear at root level on /next/... and
  // /api-gateway/next/... pages.
  var pathSegments = window.location.pathname.split('/').filter(Boolean);
  document.querySelectorAll('.md-nav--primary [data-md-scoped-version]').forEach(function (el) {
    var visible = pathSegments.indexOf(el.getAttribute('data-md-scoped-version')) !== -1;
    el.classList.toggle('md-nav__scoped--visible', visible);
  });

  document.querySelectorAll('.md-nav__item--versioned').forEach(function (section) {
    var slug = section.getAttribute('data-md-versioned-section');
    var defaultVersion = section.getAttribute('data-md-default-version');
    var select = section.querySelector('.md-nav__version-dropdown');
    var groups = Array.prototype.slice.call(
      section.querySelectorAll('.md-nav__version-group')
    );
    if (!slug || !select || groups.length === 0) return;

    var storageKey = 'docVersion:' + slug;

    // Available version values, in the order rendered.
    var versions = groups.map(function (g) {
      return g.getAttribute('data-md-version');
    });

    // Resolve the active version: URL path segment wins, then stored
    // preference, then the configured default.
    function versionFromPath() {
      // Match ".../<slug>/<version>/..." anywhere in the path.
      var parts = window.location.pathname.split('/').filter(Boolean);
      var idx = parts.lastIndexOf(slug);
      if (idx !== -1 && idx + 1 < parts.length) {
        var candidate = parts[idx + 1];
        if (versions.indexOf(candidate) !== -1) return candidate;
      }
      return null;
    }

    var stored = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch (e) {
      stored = null;
    }

    var active =
      versionFromPath() ||
      (versions.indexOf(stored) !== -1 ? stored : null) ||
      (versions.indexOf(defaultVersion) !== -1 ? defaultVersion : versions[0]);

    function showVersion(version) {
      groups.forEach(function (g) {
        g.classList.toggle('is-active', g.getAttribute('data-md-version') === version);
      });
      // A version can be active without being offered in the dropdown (e.g.
      // "next" exists in the nav but is reachable only by URL). Append it
      // under its own group so the select reflects the active version
      // instead of going blank, and so the user can switch back to a
      // released version.
      if (!select.querySelector('option[value="' + version + '"]')) {
        var unreleasedGroup = select.querySelector('optgroup[label="Unreleased"]');
        if (!unreleasedGroup) {
          unreleasedGroup = document.createElement('optgroup');
          unreleasedGroup.label = 'Unreleased';
          select.appendChild(unreleasedGroup);
        }
        var option = document.createElement('option');
        option.value = version;
        option.textContent = version;
        unreleasedGroup.appendChild(option);
      }
      if (select.value !== version) select.value = version;
      fitSelectToValue(select);
      try {
        window.localStorage.setItem(storageKey, version);
      } catch (e) {
        /* storage unavailable: selection simply won't persist */
      }
    }

    showVersion(active);

    // Collect the set of page paths available in a given version's group, plus
    // that version's overview (first link) as the fallback target.
    function groupForVersion(version) {
      return groups.filter(function (g) {
        return g.getAttribute('data-md-version') === version;
      })[0];
    }

    function pathTailAfterVersion(pathname, version) {
      // Returns the part of the path after "<slug>/<version>/", or null.
      var marker = '/' + slug + '/' + version + '/';
      var i = pathname.indexOf(marker);
      if (i === -1) return null;
      return pathname.slice(i + marker.length);
    }

    select.addEventListener('change', function () {
      fitSelectToValue(select);
      var target = select.value;
      var group = groupForVersion(target);

      // This version isn't part of the current build (e.g. a single-version
      // image built from one of the per-version Dockerfiles) — send the user
      // to that version's docs on the live site instead.
      if (!group) {
        window.location.href = LIVE_SITE_BASE + slug + '/' + target + '/';
        return;
      }

      var links = Array.prototype.slice.call(group.querySelectorAll('a[href]'));
      if (links.length === 0) {
        showVersion(target);
        return;
      }

      // Build the equivalent URL: same tail path, new version segment. Compare
      // against each link's resolved pathname (hrefs in the nav are relative).
      var current = versionFromPath();
      var tail = current ? pathTailAfterVersion(window.location.pathname, current) : null;

      var destination = null;
      if (tail !== null) {
        var wanted = ('/' + slug + '/' + target + '/' + tail).replace(/\/+$/, '');
        for (var i = 0; i < links.length; i++) {
          var linkPath = new URL(links[i].href).pathname.replace(/\/+$/, '');
          if (linkPath.slice(-wanted.length) === wanted) {
            destination = links[i].href;
            break;
          }
        }
      }

      // Fall back to the new version's overview (its first rendered link).
      if (!destination) destination = links[0].href;

      // Persist before navigating so the new page restores the same version.
      try {
        window.localStorage.setItem(storageKey, target);
      } catch (e) {
        /* ignore */
      }
      window.location.href = destination;
    });
  });
});

/*
 * Cross-product navigation (PoC)
 * -------------------------------------------------------------------------
 * Each product+version is built and deployed independently - see the
 * per-version branches - so a page from one product doesn't have any other
 * product's pages locally. To still show one unified, cross-linked sidebar,
 * every page fetches root-index.json (product -> manifest URL) from the
 * docs-shared deployment plus, for every OTHER product, that product's own
 * <slug>/product-nav-manifest.json - a full title+url+children tree
 * written by the shared docs_shared_hooks package's manifest builder. That's
 * enough to render the other product's section from data alone; clicking into it is
 * a real navigation (forced past instant-loading, since the target page
 * belongs to a different build), routed by the reverse proxy to that
 * product's own deployment.
 *
 * Each rendered section gets its own version dropdown too (mirroring the
 * native one above), sourced from the manifest's full allVersions list.
 * Unlike the native dropdown there's no "current page in this other
 * product" to find an equivalent of, so picking a version always navigates
 * to that version's overview page - whether it's served locally or (like a
 * same-product version this build doesn't have) only on the live site.
 *
 * PoC simplification: fetches every other product eagerly on page load. A
 * real implementation should lazy-fetch a product's manifest only the
 * first time its section is expanded.
 */
// root-index.json now lives in its own docs-shared deployment, not bundled
// into each product's own build. theme.js runs in the context of whichever
// page loaded it - not docs-shared's own origin - so this must be an
// absolute URL, not a path relative to the current page. Every other
// manifest fetch below still resolves against that page's own scope, since
// each product's manifest stays in that product's own deployment.
var SHARED_BASE = 'https://8c140a8d-7209-401b-84ab-2aebe8deaa80.e1-us-east-azure.choreoapps.dev/';

/*
 * Combined search index
 * -------------------------------------------------------------------------
 * Material resolves search/search_index.json against __md_scope (the staging
 * site root), so the browser asks for docs-staging/search/search_index.json.
 * That path depends on an infra rewrite to this deployment; while that is
 * unreliable, fetch the index from SHARED_BASE the same way breadcrumbs do.
 * Docs-shared already allows CORS (*). Only rewrite the staging-root combined
 * index — leave product-scoped indexes (e.g. …/ai-gateway/search/…) alone,
 * and leave every other fetch (assets, manifests, …) alone.
 */
(function () {
  var nativeFetch = window.fetch;
  if (typeof nativeFetch !== 'function' || nativeFetch.__docsSharedSearchPatched) {
    return;
  }

  // Version segment in /docs-staging/<product>/<version>/… (1.2.0, next, 2026.09.24).
  var VERSION_SEG = /^(next|\d[\w.-]*)$/i;

  function pageProductVersion() {
    var parts = location.pathname.split('/').filter(Boolean);
    var staging = parts.indexOf('docs-staging');
    if (staging === -1 || staging + 2 >= parts.length) return null;
    var slug = parts[staging + 1];
    var ver = parts[staging + 2];
    if (!slug || !VERSION_SEG.test(ver)) return null;
    return { slug: slug, version: ver };
  }

  function sharedSearchIndexUrl(input) {
    try {
      var href;
      if (typeof input === 'string') {
        href = input;
      } else if (input && typeof input.url === 'string') {
        href = input.url;
      } else if (typeof URL !== 'undefined' && input instanceof URL) {
        href = input.href;
      } else {
        return null;
      }
      var url = new URL(href, location.href);
      var path = url.pathname;
      if (!/\/search\/search_index\.json$/i.test(path)) {
        return null;
      }
      // Already hitting docs-shared — do not loop.
      if (url.href.indexOf(SHARED_BASE) === 0) {
        return null;
      }

      // Product-level search without a version (…/<slug>/search/…) on a
      // versioned page → pin to …/<slug>/<ver>/search/…. URL-driven for any
      // product; routers must expose /<slug>/<ver>/search/. Avoids Referer
      // routing (search worker Referer is /<slug>/assets/… → always default).
      var productSearch = path.match(
        /^(.*\/docs-staging\/)([^/]+)\/search\/search_index\.json$/i
      );
      if (productSearch) {
        var pv = pageProductVersion();
        if (pv && pv.slug === productSearch[2]) {
          return productSearch[1] + pv.slug + '/' + pv.version +
            '/search/search_index.json';
        }
        return null;
      }

      // Only rewrite the staging-root combined index to docs-shared.
      if (!/\/docs-staging\/search\/search_index\.json$/i.test(path) &&
          path !== '/search/search_index.json') {
        return null;
      }
      return new URL('search/search_index.json', SHARED_BASE).href;
    } catch (e) {
      return null;
    }
  }

  function patchedFetch(input, init) {
    var rewritten = sharedSearchIndexUrl(input);
    if (rewritten) {
      return nativeFetch.call(this, rewritten, init);
    }
    return nativeFetch.call(this, input, init);
  }

  patchedFetch.__docsSharedSearchPatched = true;
  window.fetch = patchedFetch;
})();

/*
 * Product / version-scoped search (e.g. AI Gateway)
 * -------------------------------------------------------------------------
 * When __md_scope is rewritten to …/docs-staging/<slug>/ or
 * …/docs-staging/<slug>/<version>/ so Material loads that deployment's
 * index (not the combined staging index):
 *   1. Empty-state meta: "Type to start searching" →
 *      "Type to start searching AI Gateway 1.0.0"
 *   2. Result hrefs: the index still stores locations as <slug>/<ver>/…,
 *      so Material can produce doubled paths
 *      (…/ai-gateway/ai-gateway/… or …/ai-gateway/1.0.0/ai-gateway/1.0.0/…).
 *      Collapse those before the user clicks.
 */
(function () {
  var EMPTY_META = 'Type to start searching';

  function humanizeSlug(slug) {
    return String(slug || '').split('-').map(function (part) {
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  }

  // Product name only — never the nested nav tree. Unversioned sections
  // (e.g. Cloud) put data-md-xproduct on the <li> that wraps every child
  // link; reading that node's textContent dumped the whole sidebar into
  // "Type to start searching …".
  function shortNavLabel(el) {
    if (!el) return '';
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 48) return '';
    return text;
  }

  function productTitle(slug) {
    var section = document.querySelector(
      '.md-nav__item--versioned[data-md-versioned-section="' + slug + '"]'
    );
    if (section) {
      var select = section.querySelector('select[aria-label]');
      if (select) {
        var label = (select.getAttribute('aria-label') || '')
          .replace(/\s+version\s*$/i, '')
          .trim();
        if (label) return label;
      }
      var versionedTitle = shortNavLabel(
        section.querySelector('.md-nav__versioned-title')
      );
      if (versionedTitle) return versionedTitle;
    }
    var xproduct = document.querySelector('[data-md-xproduct="' + slug + '"]');
    if (xproduct) {
      var fromHeader = shortNavLabel(
        xproduct.querySelector(':scope > .md-nav__versioned-header .md-nav__versioned-title')
      );
      if (fromHeader) return fromHeader;
      // Unversioned product section: title is the direct toggle label only.
      var fromToggle = shortNavLabel(
        xproduct.querySelector(':scope > label.md-nav__link')
      ) || shortNavLabel(
        xproduct.querySelector(':scope > a.md-nav__link')
      ) || shortNavLabel(
        xproduct.querySelector(':scope > .md-nav__link')
      );
      if (fromToggle) return fromToggle;
    }
    return humanizeSlug(slug);
  }

  var VERSION_SEG = /^(next|\d[\w.-]*)$/i;

  function activeVersion(slug) {
    var pathParts = location.pathname.split('/').filter(Boolean);
    var idx = pathParts.indexOf(slug);
    if (idx !== -1 && idx + 1 < pathParts.length) {
      var candidate = pathParts[idx + 1];
      if (VERSION_SEG.test(candidate)) return candidate;
    }
    var section = document.querySelector(
      '.md-nav__item--versioned[data-md-versioned-section="' + slug + '"]'
    );
    if (section) {
      var select = section.querySelector('select');
      if (select && select.value) return select.value;
    }
    return null;
  }

  // { slug, version|null } when __md_scope is product or version scoped; else null.
  // Any product slug — no hard-coded product list (ai-gateway, api-gateway, …).
  function productScopeInfo() {
    var scope = window.__md_scope;
    if (!scope) return null;
    var scopePath;
    try {
      scopePath = scope.pathname || new URL(String(scope.href || scope)).pathname;
    } catch (e) {
      return null;
    }
    if (scopePath.charAt(scopePath.length - 1) !== '/') scopePath += '/';
    var match = scopePath.match(/\/docs-staging\/([^/]+)(?:\/([^/]+))?\/$/);
    if (!match) return null;
    var slug = match[1];
    var maybeVer = match[2] || null;
    if (maybeVer && !VERSION_SEG.test(maybeVer)) {
      maybeVer = null;
    }
    return { slug: slug, version: maybeVer };
  }

  // Null when search is combined; otherwise "AI Gateway 1.0.0".
  function scopedSearchLabel() {
    var info = productScopeInfo();
    if (!info) return null;
    var title = productTitle(info.slug);
    var version = info.version || activeVersion(info.slug);
    return version ? (title + ' ' + version) : title;
  }

  function applyScopedEmptyMeta() {
    var label = scopedSearchLabel();
    if (!label) return;
    var meta = document.querySelector('.md-search-result__meta');
    if (!meta) return;
    var text = (meta.textContent || '').replace(/\s+/g, ' ').trim();
    // Only the empty-state line — leave "N matching documents" alone.
    if (text === EMPTY_META || text.indexOf(EMPTY_META) === 0) {
      var desired = EMPTY_META + ' ' + label;
      if (text !== desired) meta.textContent = desired;
    }
  }

  // …/ai-gateway/ai-gateway/… → …/ai-gateway/…
  // …/ai-gateway/1.0.0/ai-gateway/1.0.0/… → …/ai-gateway/1.0.0/…
  function fixDoubledProductSearchLinks(root) {
    var info = productScopeInfo();
    if (!info || !root) return;
    var slug = info.slug;
    var ver = info.version || activeVersion(slug);
    var patterns = [];
    if (ver) {
      patterns.push({
        doubled: '/' + slug + '/' + ver + '/' + slug + '/' + ver + '/',
        single: '/' + slug + '/' + ver + '/'
      });
    }
    patterns.push({
      doubled: '/' + slug + '/' + slug + '/',
      single: '/' + slug + '/'
    });
    root.querySelectorAll('.md-search-result__link').forEach(function (link) {
      try {
        var url = new URL(link.href);
        var path = url.pathname;
        for (var i = 0; i < patterns.length; i++) {
          if (path.indexOf(patterns[i].doubled) !== -1) {
            url.pathname = path.split(patterns[i].doubled).join(patterns[i].single);
            link.href = url.pathname + url.search + url.hash;
            break;
          }
        }
      } catch (e) { /* ignore */ }
    });
  }

  function applyScopedSearchFixes() {
    applyScopedEmptyMeta();
    var output = document.querySelector('[data-md-component="search-result"]');
    fixDoubledProductSearchLinks(output);
  }

  onFirstPage(function () {
    var output = document.querySelector('[data-md-component="search-result"]');
    if (!output) return;
    applyScopedSearchFixes();
    var observer = new MutationObserver(function () { applyScopedSearchFixes(); });
    observer.observe(output, { childList: true, subtree: true, characterData: true });
  });

  onEachPage(applyScopedSearchFixes);
})();

onEachPage(function () {
  var primaryList = document.querySelector('.md-nav--primary > .md-nav__list');
  if (!primaryList) return;

  var scope = window.__md_scope ||
    (document.querySelector('base') ? new URL(document.querySelector('base').href) : new URL('/', location));

  // Sections already rendered server-side (this build's own product) don't
  // need to be fetched again. Previously this was decided by fetching
  // assets/own-product-slugs.json (relative to `scope`, which - by design,
  // so Referer-routed /assets/ works - always resolves to the bare site
  // root, stripping the product/version prefix the external URL has). That
  // request therefore carries no product-identifying path segment of its
  // own, so infra can only ever forward it to ONE fixed backend - every
  // product's page ended up fetching whichever product's own-slugs file
  // that backend happens to serve, not its own. Caught live: every page
  // reported another specific product's slug back, wrongly suppressing
  // that product's cross-product section everywhere while failing to
  // suppress its OWN section on its own page (rendering it twice).
  //
  // The current URL's own path doesn't have this problem - it's the one
  // piece of product-identifying context a cross-origin asset fetch can
  // never give, but `location` already has for free. _liveSiteBase (below)
  // gives the common prefix every product's URL shares; the first path
  // segment after it is this page's own product slug.
  function currentSlugFromLocation(liveSiteBase) {
    try {
      var basePath = new URL(liveSiteBase, location).pathname.replace(/\/+$/, '') + '/';
      var path = location.pathname;
      if (path.indexOf(basePath) !== 0) return null;
      return path.slice(basePath.length).split('/')[0] || null;
    } catch (e) {
      return null;
    }
  }

  // Every top-level product section - native or cross-product - must sit in
  // the same place regardless of which product's page rendered it, or the
  // sidebar reorders itself depending on where you're browsing from.
  // root-index.json's key order (preserved by JS for string keys) is the
  // single canonical order every page agrees on.
  //
  // hr, if given, is this section's expanded_navs divider (see hooks.py's
  // _section_style) - it must land immediately before the li itself, same as
  // nav-item.html renders it as the li's preceding sibling.
  function insertProductSection(li, slug, order, hr) {
    var targetRank = order.indexOf(slug);
    if (targetRank === -1) targetRank = order.length;
    var items = primaryList.children;
    for (var i = 0; i < items.length; i++) {
      var itemSlug = items[i].getAttribute('data-md-versioned-section') || items[i].getAttribute('data-md-xproduct');
      if (itemSlug && order.indexOf(itemSlug) > targetRank) {
        // Capture the reference once: items is the live children collection,
        // so inserting hr first shifts this same item to a new index, and
        // re-reading items[i] afterward would resolve to hr itself instead -
        // landing li BEFORE its own divider.
        var ref = items[i];
        // If ref already owns a leading divider (its own expanded_navs
        // divider, rendered as ref's preceding sibling by nav-item.html),
        // that hr belongs to ref, not to whatever's being inserted here.
        // Inserting before ref itself would land the new li (and its own
        // hr) BETWEEN ref's divider and ref - stealing ref's divider
        // position and leaving ref with none. Insert before that divider
        // instead, so ref keeps its own and the new one still precedes it.
        var prev = ref.previousElementSibling;
        if (prev && prev.tagName === 'HR' && prev.classList.contains('md-nav--expanded-section-divider')) {
          ref = prev;
        }
        if (hr) primaryList.insertBefore(hr, ref);
        primaryList.insertBefore(li, ref);
        return;
      }
    }
    if (hr) primaryList.appendChild(hr);
    primaryList.appendChild(li);
  }

  // Builds this section's expanded_navs styling - a divider <hr> (or null)
  // plus the class names nav-item.html would apply to the section's own li -
  // from the divider/verticleLine/expandedSection fields hooks.py's
  // _section_style wrote into the manifest.
  function sectionStyle(manifest) {
    var classes = '';
    if (manifest.expandedSection) classes += ' md-nav--expanded-section';
    if (manifest.verticleLine) classes += ' md-nav--expanded-section-verticle-line';
    var hr = null;
    if (manifest.divider) {
      hr = document.createElement('hr');
      hr.className = 'md-nav--expanded-section-divider';
    }
    return { classes: classes, hr: hr };
  }

  var idCounter = 0;
  function nextId() { return '__xproduct_' + idCounter++; }

  // Resolve each node's page url into an absolute href up front, relative
  // to that product+version's own base, so renderNode itself doesn't need
  // to know about slugs/versions/scope.
  function resolveHrefs(nodes, base) {
    return nodes.map(function (n) {
      if (n.url !== undefined) {
        return { title: n.title, href: new URL(n.url, base).href };
      }
      return { title: n.title, children: resolveHrefs(n.children || [], base) };
    });
  }

  // Where to resolve a cross-product section's links against - whatever
  // manifestUrl actually says, in full, not just its origin. manifestUrl
  // always ends in "<slug>/product-nav-manifest.json"; stripping exactly
  // that suffix leaves the correct base to resolve the tree's relative
  // page urls against, whether manifestUrl is a bare Choreo address
  // (https://50dcbee2-.../analytics/product-nav-manifest.json -> base
  // https://50dcbee2-.../) or one that carries its own path prefix
  // (https://wso2.com/api-platform/docs-staging/analytics/product-nav-
  // manifest.json -> base https://wso2.com/api-platform/docs-staging/).
  //
  // Using .origin here (an earlier version of this function did) silently
  // drops any such prefix, since .origin is always just protocol+host -
  // that's what previously sent cross-product links to
  // https://wso2.com/analytics/overview/ instead of
  // https://wso2.com/api-platform/docs-staging/analytics/overview/.
  function productOriginFor(product, slug) {
    var manifestUrl = new URL(product.manifestUrl, scope).href;
    var suffix = slug + '/product-nav-manifest.json';
    if (manifestUrl.slice(-suffix.length) === suffix) {
      return manifestUrl.slice(0, manifestUrl.length - suffix.length);
    }
    // manifestUrl didn't have the expected shape - fall back to its origin
    // rather than produce a broken base.
    return new URL(product.manifestUrl, scope).origin + '/';
  }

  // A raw SVG string, for a section's own nav_icons entry (see hooks.py's
  // _section_icon) - mirrors nav-item.html's own icon rendering, since a
  // page showing another product's section has no local .icons/ directory
  // to resolve an icon name from itself.
  function iconSpan(svg) {
    var span = document.createElement('span');
    span.className = 'icon';
    span.innerHTML = svg;
    return span;
  }

  // sectionIcon is only ever passed for the single top-level call building
  // a cross-product section (see renderFlatProductSection) - recursive
  // calls below for a node's own children never pass one, since nav_icons
  // only ever applies to a level-1 section, never a nested child.
  function renderNode(node, sectionIcon) {
    var li = document.createElement('li');
    li.className = 'md-nav__item';

    if (node.children && node.children.length) {
      li.className += ' md-nav__item--nested';
      if (sectionIcon) li.className += ' md-nav--has-icon';
      var id = nextId();

      var input = document.createElement('input');
      input.className = 'md-nav__toggle md-toggle';
      input.type = 'checkbox';
      input.id = id;
      li.appendChild(input);

      var label = document.createElement('label');
      label.className = 'md-nav__link';
      label.setAttribute('for', id);
      var titleSpan = document.createElement('span');
      if (sectionIcon) {
        titleSpan.appendChild(iconSpan(sectionIcon));
        titleSpan.appendChild(document.createTextNode(' ' + node.title));
      } else {
        titleSpan.textContent = node.title;
      }
      label.appendChild(titleSpan);
      var icon = document.createElement('span');
      icon.className = 'md-nav__icon md-icon';
      label.appendChild(icon);
      li.appendChild(label);

      var nested = document.createElement('nav');
      nested.className = 'md-nav';
      var nestedTitle = document.createElement('label');
      nestedTitle.className = 'md-nav__title';
      nestedTitle.setAttribute('for', id);
      nestedTitle.textContent = node.title;
      nested.appendChild(nestedTitle);
      var ul = document.createElement('ul');
      ul.className = 'md-nav__list';
      node.children.forEach(function (child) { ul.appendChild(renderNode(child)); });
      nested.appendChild(ul);
      li.appendChild(nested);
    } else {
      var a = document.createElement('a');
      a.className = 'md-nav__link';
      a.href = node.href;
      var linkSpan = document.createElement('span');
      linkSpan.textContent = node.title;
      a.appendChild(linkSpan);
      // Force a real navigation past instant-loading: the target page
      // belongs to a different product's build, not this one. Keep the
      // real href so open-in-new-tab / copy-link / hover preview still work.
      a.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        window.location.href = node.href;
      });
      li.appendChild(a);
    }
    return li;
  }

  // Mirrors the native versioned-section markup (nav-item.html's
  // .md-nav__item--versioned block) so a cross-product section looks and
  // behaves the same as a locally-built one, including its own version
  // dropdown - existing CSS styles it correctly with no changes needed.
  function renderProductSection(slug, product, manifest, order) {
    if (primaryList.querySelector('[data-md-xproduct="' + slug + '"]')) return;

    // The manifest's node urls are root-relative under <slug>/<version>/ -
    // see productOriginFor for which origin that gets resolved against.
    var productOrigin = productOriginFor(product, slug);

    var allVersions = (manifest.allVersions && manifest.allVersions.length)
      ? manifest.allVersions
      : Object.keys(manifest.versions);
    if (!allVersions.length) return;

    // Latest/Previous grouping, same as the native dropdown: the
    // configured default if it's in the advertised list, else just the
    // first entry.
    var latestLabel = (manifest.default && allVersions.indexOf(manifest.default) !== -1)
      ? manifest.default
      : allVersions[0];
    var stsVersions = manifest.stsVersions || [];
    var previousLabels = allVersions.filter(function (v) {
      return v !== latestLabel && stsVersions.indexOf(v) === -1;
    });

    // What to actually show first must be a version this manifest has data
    // for - not necessarily latestLabel, which can be configured as the
    // overall default while THIS build only has some other version (e.g. a
    // single-version API Manager image). Falling back to latestLabel here
    // would redirect the reader away the moment the sidebar renders.
    var presentVersions = Object.keys(manifest.versions);
    var initialVersion = (manifest.default && manifest.versions[manifest.default])
      ? manifest.default
      : presentVersions[0];
    if (!initialVersion) return;

    var style = sectionStyle(manifest);
    var id = nextId();
    var li = document.createElement('li');
    li.className = 'md-nav__item md-nav__item--nested md-nav__item--versioned'
      + (manifest.icon ? ' md-nav--has-icon' : '') + style.classes;
    li.setAttribute('data-md-xproduct', slug);

    var input = document.createElement('input');
    input.className = 'md-nav__toggle md-toggle';
    input.type = 'checkbox';
    input.id = id;
    li.appendChild(input);

    var header = document.createElement('div');
    header.className = 'md-nav__link md-nav__versioned-header';

    var titleLabel = document.createElement('label');
    titleLabel.className = 'md-nav__versioned-title';
    titleLabel.setAttribute('for', id);
    var titleSpan = document.createElement('span');
    if (manifest.icon) {
      titleSpan.appendChild(iconSpan(manifest.icon));
      titleSpan.appendChild(document.createTextNode('\xa0' + (product.title || slug)));
    } else {
      titleSpan.textContent = product.title || slug;
    }
    titleLabel.appendChild(titleSpan);
    header.appendChild(titleLabel);

    var select = document.createElement('select');
    select.className = 'md-nav__version-dropdown';
    select.setAttribute('aria-label', (product.title || slug) + ' version');

    function addOption(group, version) {
      var option = document.createElement('option');
      option.value = version;
      option.textContent = version;
      if (version === initialVersion) option.selected = true;
      group.appendChild(option);
    }

    var latestGroup = document.createElement('optgroup');
    latestGroup.label = stsVersions.length ? 'Latest LTS Version' : 'Latest Version';
    addOption(latestGroup, latestLabel);
    select.appendChild(latestGroup);

    if (stsVersions.length) {
      var stsGroup = document.createElement('optgroup');
      stsGroup.label = 'Latest STS Version';
      stsVersions.forEach(function (v) { addOption(stsGroup, v); });
      select.appendChild(stsGroup);
    }

    if (previousLabels.length) {
      var previousGroup = document.createElement('optgroup');
      previousGroup.label = 'Previous Versions';
      previousLabels.forEach(function (v) { addOption(previousGroup, v); });
      select.appendChild(previousGroup);
    }
    header.appendChild(select);

    var toggle = document.createElement('label');
    toggle.className = 'md-nav__icon md-icon md-nav__versioned-toggle';
    toggle.setAttribute('for', id);
    header.appendChild(toggle);

    li.appendChild(header);

    var nested = document.createElement('nav');
    nested.className = 'md-nav';
    var nestedTitle = document.createElement('label');
    nestedTitle.className = 'md-nav__title';
    nestedTitle.setAttribute('for', id);
    nestedTitle.textContent = product.title || slug;
    nested.appendChild(nestedTitle);
    li.appendChild(nested);

    // Renders the given version's tree into the section - used once, for
    // whichever version is shown when the section first appears.
    function renderVersionGroup(version) {
      var tree = manifest.versions[version];
      if (!tree) return;
      var group = document.createElement('div');
      group.className = 'md-nav__version-group is-active';
      group.setAttribute('data-md-version', version);
      var ul = document.createElement('ul');
      ul.className = 'md-nav__list';
      // Each node's url is already site-root-relative (it includes its own
      // slug/version prefix - see hooks.py's _nav_tree, sourced from
      // mkdocs' own page.url), so resolve against that product's own
      // origin - not this page's.
      resolveHrefs(tree, productOrigin).forEach(function (n) { ul.appendChild(renderNode(n)); });
      group.appendChild(ul);
      nested.appendChild(group);
    }

    // Finds the first page url in a tree, depth-first - the "overview" page
    // for whatever version this is (mkdocs' own nav puts a section's index
    // page first, same convention the same-product dropdown's own "fall
    // back to the new version's overview" relies on).
    function firstPageUrl(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.url !== undefined) return n.url;
        if (n.children && n.children.length) {
          var found = firstPageUrl(n.children);
          if (found) return found;
        }
      }
      return null;
    }

    select.addEventListener('change', function () {
      var version = select.value;
      // There's no "current page in this other product" to find an
      // equivalent of, unlike the same-product dropdown - so a cross-
      // product version switch always takes the reader to that version's
      // overview page, whether it's served locally or (like an absent
      // same-product version) only on the live site.
      var tree = manifest.versions[version];
      var url = tree && firstPageUrl(tree);
      window.location.href = url
        ? new URL(url, productOrigin).href
        : LIVE_SITE_BASE + slug + '/' + version + '/';
    });

    insertProductSection(li, slug, order, style.hr);
    renderVersionGroup(initialVersion);
    fitSelectToValue(select);
  }

  // An unversioned product's manifest (see hooks.py's _build_product_nav_
  // manifest) is a flat {slug, tree} - no version dropdown, so this reuses
  // renderNode's plain nested-item rendering directly instead of the
  // versioned header/dropdown markup above.
  function renderFlatProductSection(slug, product, manifest, order) {
    if (primaryList.querySelector('[data-md-xproduct="' + slug + '"]')) return;
    if (!manifest.tree || !manifest.tree.length) return;

    var productOrigin = productOriginFor(product, slug);
    var resolved = resolveHrefs(manifest.tree, productOrigin);
    var li = renderNode({ title: product.title || slug, children: resolved }, manifest.icon);
    li.setAttribute('data-md-xproduct', slug);
    var style = sectionStyle(manifest);
    if (style.classes) li.className += style.classes;
    insertProductSection(li, slug, order, style.hr);
  }

  fetch(new URL(SHARED_BASE + 'root-index.json', scope)).then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (index) {
      // _liveSiteBase overrides the LIVE_SITE_BASE fallback declared above,
      // if the mounted root-index.json provides one - falls back to that
      // hardcoded default if this fetch hasn't resolved yet or fails.
      if (index._liveSiteBase) LIVE_SITE_BASE = index._liveSiteBase;
      var currentSlug = currentSlugFromLocation(LIVE_SITE_BASE);

      // Overview/Get Started are plain top-level links, baked into every
      // branch's own mkdocs.yml nav pointing at platform-common's URL at
      // build time - unlike a product section, they're not in
      // versioned_sections/unversioned_sections, so nav-item.html gives them
      // no data-md-xproduct/data-md-versioned-section to identify them by.
      // Matched by title text instead, among top-level items only, so a
      // platform-common redeploy only means updating _platformCommonBase
      // here, not editing and rebuilding every product branch.
      if (index._platformCommonBase) {
        var platformCommonLinks = { 'Overview': '', 'Get Started': 'get-started/' };
        Array.prototype.forEach.call(primaryList.children, function (item) {
          var link = item.querySelector && item.querySelector(':scope > a.md-nav__link');
          if (!link) return;
          var title = link.textContent.trim();
          if (Object.prototype.hasOwnProperty.call(platformCommonLinks, title)) {
            link.href = new URL(index._platformCommonBase + platformCommonLinks[title], scope).href;
          }
        });
      }

      var products = index.products || {};
      var order = Object.keys(products);
      order.forEach(function (slug) {
        if (slug === currentSlug) return;
        var product = products[slug];
        fetch(new URL(product.manifestUrl, scope))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (manifest) {
            if (!manifest) return;
            if (manifest.versions) {
              renderProductSection(slug, product, manifest, order);
            } else {
              renderFlatProductSection(slug, product, manifest, order);
            }
          })
          .catch(function () { /* best-effort: skip this product on error */ });
      });
    })
    .catch(function () { /* best-effort: no cross-product nav this load */ });
});

/*
 * Search result breadcrumbs + version scoping
 * -------------------------------------------------------------------------
 * Across products / versions many pages share a title ("Overview", "Regex
 * Guardrail", ...). Material's search results show only the title, so results
 * are ambiguous and (because every version is indexed) the same page appears
 * once per version. We:
 *   1. Load a URL -> breadcrumb map from docs-shared
 *      (assets/search-breadcrumbs.json, merged like the global search index)
 *      and inject the breadcrumb (e.g. "AI Gateway › 1.1.0 › LLM Proxy ›
 *      Guardrails") under each result.
 *   2. Hide results from a NON-active version of a versioned product, so a user
 *      who selected 1.0.0 only sees 1.0.0 hits (plus non-versioned results such
 *      as Cloud / Guides). Active version is resolved exactly like the nav
 *      selector: URL segment > localStorage > configured default.
 */
(function () {
  // The search dialog belongs to the header, which instant navigation keeps in
  // place, so the observer is installed once per session.
  var output = null;

  // Material exposes the site root as an absolute URL in `window.__md_scope`
  // (set on every page, e.g. https://host/bijira/docs/). Use it to build the
  // fetch URL and to turn a result's pathname into a build-time breadcrumb key.
  // Fall back to a <base> tag, then the server root. Re-read on each page —
  // product branches pin scope to /<slug>/<version>/ for scoped search.
  var scope = null;
  var basePath = '/';
  var breadcrumbs = null;
  var breadcrumbsUrl = null;
  var pending = false;

  function refreshScope() {
    scope = window.__md_scope ||
      (document.querySelector('base') ? new URL(document.querySelector('base').href) : new URL('/', location));
    basePath = scope.pathname;
    if (basePath.charAt(basePath.length - 1) !== '/') basePath += '/';
  }
  refreshScope();

  // Resolve, per versioned product (slug), which version is "active" for this
  // page. Reads the global versioned-nav DOM, mirroring the nav selector logic.
  var activeVersions = null;
  function getActiveVersions() {
    if (activeVersions) return activeVersions;
    activeVersions = {};
    document.querySelectorAll('.md-nav__item--versioned').forEach(function (section) {
      var slug = section.getAttribute('data-md-versioned-section');
      var def = section.getAttribute('data-md-default-version');
      if (!slug) return;
      var versions = [];
      section.querySelectorAll('.md-nav__version-group').forEach(function (g) {
        var v = g.getAttribute('data-md-version');
        if (v) versions.push(v);
      });
      var active = null;
      var parts = window.location.pathname.split('/').filter(Boolean);
      var idx = parts.lastIndexOf(slug);
      if (idx !== -1 && idx + 1 < parts.length && versions.indexOf(parts[idx + 1]) !== -1) {
        active = parts[idx + 1];
      }
      if (!active) {
        try {
          var s = window.localStorage.getItem('docVersion:' + slug);
          if (versions.indexOf(s) !== -1) active = s;
        } catch (e) { /* ignore */ }
      }
      if (!active) active = versions.indexOf(def) !== -1 ? def : versions[0];
      activeVersions[slug] = { active: active, versions: versions };
    });
    return activeVersions;
  }

  function keyForHref(href) {
    var path;
    try {
      path = new URL(href, scope).pathname;
    } catch (e) {
      return null;
    }
    // Strip the base path prefix to match the JSON keys (relative page URLs).
    if (basePath !== '/' && path.indexOf(basePath) === 0) {
      path = path.slice(basePath.length);
    } else {
      path = path.replace(/^\//, '');
    }
    if (path && path.charAt(path.length - 1) !== '/') path += '/';
    // Product- or version-scoped __md_scope: after collapsing doubled result
    // URLs, breadcrumb keys still use ai-gateway/1.2.0/…. Re-prefix when the
    // stripped path no longer starts with the product slug.
    var scopeSlugMatch = basePath.match(
      /\/docs-staging\/([^/]+)(?:\/([^/]+))?\/$/
    );
    if (scopeSlugMatch && path) {
      var slug = scopeSlugMatch[1];
      var ver = scopeSlugMatch[2];
      if (ver && /^(next|\d[\w.-]*)$/i.test(ver)) {
        var prefix = slug + '/' + ver + '/';
        if (path.indexOf(prefix) !== 0) {
          if (path.indexOf(slug + '/') === 0) {
            // already product-prefixed
          } else if (path.indexOf(ver + '/') === 0) {
            path = slug + '/' + path;
          } else {
            path = prefix + path;
          }
        }
      } else if (path.indexOf(slug + '/') !== 0) {
        path = slug + '/' + path;
      }
    }
    return path;
  }

  // Version values used by version-scoped doc sets (extra.version_scoped_navs),
  // whose pages live under "<version>/..." (e.g. next/ai-workspace/...).
  var scopedVersions = null;
  function getScopedVersions() {
    if (scopedVersions) return scopedVersions;
    scopedVersions = {};
    document.querySelectorAll('.md-nav--primary [data-md-scoped-version]').forEach(function (el) {
      scopedVersions[el.getAttribute('data-md-scoped-version')] = true;
    });
    return scopedVersions;
  }

  // True if the page key belongs to a non-active version (should be hidden).
  function isHiddenVersion(key) {
    if (!key) return false;
    var parts = key.split('/');
    if (parts.length < 2) return false;
    // Version-scoped doc sets: hide unless that version is in the current URL
    // (mirrors the nav visibility rule for these sections).
    if (getScopedVersions()[parts[0]]) {
      return window.location.pathname.split('/').indexOf(parts[0]) === -1;
    }
    var cfg = getActiveVersions()[parts[0]];
    if (!cfg) return false;
    if (cfg.versions.indexOf(parts[1]) === -1) return false; // not a version segment
    return parts[1] !== cfg.active;
  }

  function decorate() {
    if (!breadcrumbs || !output) return;
    var items = output.querySelectorAll('.md-search-result__item');
    var visible = 0;
    items.forEach(function (item) {
      var link = item.querySelector('.md-search-result__link');
      if (!link) return;
      var key = keyForHref(link.getAttribute('href') || link.href);

      // 1. Version scoping: hide results from non-active versions.
      var hide = isHiddenVersion(key);
      item.style.display = hide ? 'none' : '';
      if (!hide) visible++;

      // 2. Breadcrumb: inject once, under the document-level result title.
      if (!item.querySelector('.md-search-result__breadcrumbs')) {
        var crumbs = key && breadcrumbs[key];
        if (crumbs && crumbs.length) {
          var el = document.createElement('div');
          el.className = 'md-search-result__breadcrumbs';
          el.textContent = crumbs.join(' › '); // " > "
          var title = link.querySelector('.md-search-result__title');
          if (title && title.parentNode) {
            title.parentNode.insertBefore(el, title.nextSibling);
          } else {
            link.insertBefore(el, link.firstChild);
          }
        }
      }
    });

    // Keep the "N matching documents" meta count honest about what's shown.
    // Idempotent: only writes when the number actually changes (loop-safe).
    var meta = output.querySelector('.md-search-result__meta');
    if (meta && items.length && /\d/.test(meta.textContent)) {
      var desired = meta.textContent.replace(/\d[\d,]*/, String(visible));
      if (meta.textContent !== desired) meta.textContent = desired;
    }
  }

  // Landing / combined search: docs-shared map (latest-only per product).
  // Product-scoped pages (…/<slug>/, e.g. Cloud) and version-scoped pages
  // (…/<slug>/<ver>/): that deployment's own map via
  // …/assets/search-breadcrumbs.json (Cloud nginx aliases /cloud/assets/;
  // versioned products' routers path-proxy /<slug>/<ver>/assets/ → /assets/).
  // docs-shared only indexes the default host, so older versions are missing
  // from the combined file.
  function resolveBreadcrumbsUrl() {
    refreshScope();
    var productScoped = /\/docs-staging\/[^/]+\/$/i.test(basePath);
    var versionScoped = /\/docs-staging\/[^/]+\/(?:next|\d[\w.-]*)\/$/i.test(basePath);
    if (productScoped || versionScoped) {
      return new URL('assets/search-breadcrumbs.json', scope).href;
    }
    return new URL(SHARED_BASE + 'assets/search-breadcrumbs.json', scope).href;
  }

  function ensureLoadedThenDecorate() {
    var url = resolveBreadcrumbsUrl();
    if (breadcrumbs && breadcrumbsUrl === url) {
      decorate();
      return;
    }
    if (pending && breadcrumbsUrl === url) return;
    pending = true;
    breadcrumbsUrl = url;
    breadcrumbs = null;
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) {
        breadcrumbs = data;
        pending = false;
        decorate();
      })
      .catch(function () {
        breadcrumbs = {};
        pending = false;
      });
  }

  // Results are rendered asynchronously and re-rendered on each keystroke, so
  // observe the output container and (re)decorate whenever it changes.
  onFirstPage(function () {
    output = document.querySelector('[data-md-component="search-result"]');
    if (!output) return;
    var observer = new MutationObserver(function () { ensureLoadedThenDecorate(); });
    observer.observe(output, { childList: true, subtree: true });
  });

  // The active version is derived from the URL and from the navigation sidebar,
  // both of which change on navigation, so drop the resolved values and let the
  // next search re-read them.
  onEachPage(function () {
    activeVersions = null;
    scopedVersions = null;
    refreshScope();
    // Switching product/version changes which breadcrumb map applies.
    breadcrumbs = null;
    breadcrumbsUrl = null;
    pending = false;
    // Results rendered for a search made on the previous page carry that page's
    // version scoping, and Material only re-renders them when the query
    // changes, so decorate what is already on screen again.
    if (output && output.querySelector('.md-search-result__item')) {
      ensureLoadedThenDecorate();
    }
  });
})();


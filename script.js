(() => {
  const tablist = document.querySelector('[role="tablist"]');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));

  function selectTab(tab, updateLocation = true) {
    tabs.forEach((item, index) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      panels[index].hidden = !selected;
    });
    if (updateLocation) history.replaceState(null, '', `#${tab.getAttribute('aria-controls')}`);
  }

  tabs.forEach((tab, index) => {
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let nextIndex;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      tabs[nextIndex].focus();
      selectTab(tabs[nextIndex]);
    });
  });

  function restoreTab() {
    const tab = tabs.find(item => `#${item.getAttribute('aria-controls')}` === location.hash);
    selectTab(tab || tabs[0], false);
  }
  restoreTab();
  tablist.hidden = false;
  window.addEventListener('hashchange', restoreTab);
})();

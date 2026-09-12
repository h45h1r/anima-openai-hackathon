// Local demo identity only. The original client sends its API calls to this origin.
localStorage.setItem('sim-key', 'local-demo');
localStorage.setItem('sim-team', 'local-copy');
localStorage.setItem('sim-world', 'team-8942268fa18a');
sessionStorage.removeItem('sim-key');
sessionStorage.removeItem('sim-tour-world');
window.addEventListener('DOMContentLoaded', () => {
  const badge = document.createElement('span');
  badge.textContent = 'Local copy';
  badge.title = 'Original Anima simulation interface, running against the local database';
  badge.style.cssText = 'font:10px Arial,sans-serif;white-space:nowrap;color:inherit;margin-left:8px;opacity:.8';
  const attach = () => {
    const footer = document.querySelector('.workspace-status, footer.footer, footer');
    if (!footer) return;
    footer.append(badge);
    if (location.pathname.startsWith('/control')) {
      const consent = document.createElement('a');
      consent.href = '/companion/';
      consent.textContent = 'Family & consent';
      consent.style.cssText = 'margin-left:18px;color:inherit;font:12px Arial,sans-serif';
      footer.append(consent);
    }
    observer.disconnect();
  };
  const observer = new MutationObserver(attach);
  observer.observe(document.body, {childList:true,subtree:true});
  attach();
  if (location.pathname === '/gp/' || location.pathname === '/gp/index.html') {
    const link = document.createElement('a');
    link.textContent = 'Family consent';
    link.style.cssText = 'color:#174676;font:600 13px Arial,sans-serif;padding:8px 14px;border:1px solid #9eb5d3;background:#eef4ff;text-decoration:none;margin-left:10px';
    const consentNav = new MutationObserver(() => {
      const anchor = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Care coordination');
      if (anchor && !link.isConnected) anchor.after(link);
      link.href = '/gp/consent/?patient=' + encodeURIComponent(new URLSearchParams(location.search).get('patient') || 'SIM-000006');
    });
    consentNav.observe(document.body, { childList: true, subtree: true });
  }
});

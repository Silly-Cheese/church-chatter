let scheduled = false;

function route() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function svg(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

const ICONS = {
  discover: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/><path d="M8.5 11h5M11 8.5v5"/>'),
  network: svg('<path d="M8 8h8M8 16h8"/><path d="m5 5-3 3 3 3M19 13l3 3-3 3"/>')
};

function item(routeName, label, detail, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mobile-more-item ${route() === routeName ? "active" : ""}`;
  button.dataset.connectMobileRoute = routeName;
  button.innerHTML = `<span class="mobile-more-item-icon">${icon}</span><span class="mobile-more-item-copy"><strong>${label}</strong><small>${detail}</small></span>`;
  button.addEventListener("click", () => {
    document.querySelector("#mobile-more-backdrop")?.classList.remove("open");
    document.querySelector("#mobile-more-sheet")?.classList.remove("open");
    document.body.classList.remove("mobile-sheet-open");
    window.location.hash = `#/${routeName}`;
  });
  return button;
}

function sync() {
  const sheet = document.querySelector("#mobile-more-sheet");
  if (sheet) {
    const grids = sheet.querySelectorAll(".mobile-more-grid");
    const communityGrid = grids[0];
    const churchGrid = grids[1];

    if (communityGrid && !communityGrid.querySelector('[data-connect-mobile-route="discover"]')) {
      communityGrid.appendChild(item("discover", "Find a Church", "Search opted-in congregations", ICONS.discover));
    }

    const networkAvailable = Boolean(document.querySelector('.sidebar [data-route="network"]'));
    if (churchGrid && networkAvailable && !churchGrid.querySelector('[data-connect-mobile-route="network"]')) {
      churchGrid.appendChild(item("network", "Church Network", "Connect with other congregations", ICONS.network));
    }

    sheet.querySelectorAll("[data-connect-mobile-route]").forEach((button) => {
      button.classList.toggle("active", button.dataset.connectMobileRoute === route());
    });
  }

  const more = document.querySelector(".mobile-nav [data-mobile-more]");
  if (more && ["discover", "network"].includes(route())) more.classList.add("active");
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    sync();
  });
}

window.addEventListener("hashchange", schedule);
const observer = new MutationObserver(schedule);
observer.observe(document.body, { childList: true, subtree: true });
schedule();

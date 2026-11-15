// City search (built-in GeoNames list, no external geocoder) and "use my location".
// Both fly the map to the place and open the point panel there.

// Common former / alternative names -> name used in cities.json
const ALIASES = {
  bombay: "Mumbai", bangalore: "Bengaluru", madras: "Chennai", calcutta: "Kolkata",
  trivandrum: "Thiruvananthapuram", poona: "Pune", cochin: "Kochi", baroda: "Vadodara",
  mysore: "Mysuru", benares: "Varanasi", banaras: "Varanasi", calicut: "Kozhikode",
};

// Great-circle distance in km.
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function setupSearch(map, cities, panel) {
  const $ = (id) => document.getElementById(id);
  const input = $("search"), list = $("results"), locBtn = $("locate");
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const index = cities.map(([name, state, lat, lon]) => ({ name, state, lat, lon, key: norm(name) }));
  let matches = [], active = -1;

  // Nearest listed city to a point, used to name map clicks in the point panel.
  window.nearestPlace = (lat, lon) => {
    let best = null, km = Infinity;
    for (const c of index) {
      const d = haversineKm(lat, lon, c.lat, c.lon);
      if (d < km) { km = d; best = c; }
    }
    return best && { name: best.name, state: best.state, km };
  };

  window.toast = toast;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 3500);
  }

  function find(q) {
    q = norm(q.trim());
    if (!q) return [];
    const alias = ALIASES[q];
    const starts = [], contains = [];
    for (const c of index) {            // index is sorted by population, so big cities come first
      if (alias && c.name === alias) starts.unshift(c);
      else if (c.key.startsWith(q)) starts.push(c);
      else if (q.length > 2 && c.key.includes(q)) contains.push(c);
    }
    return starts.concat(contains).slice(0, 8);
  }

  function render() {
    list.innerHTML = matches.map((c, k) =>
      `<li role="option" id="opt-${k}" aria-selected="${k === active}" data-k="${k}">${c.name}<span>${c.state}</span></li>`).join("");
    list.hidden = matches.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    input.setAttribute("aria-activedescendant", active >= 0 ? `opt-${active}` : "");
  }

  function go(lat, lon, label) {
    const latlng = L.latLng(lat, lon);
    map.flyTo(latlng, Math.max(map.getZoom(), 6), { duration: 0.8 });
    if (!panel.open(latlng, label)) toast(`${label} is outside the forecast area (India).`);
  }

  function choose(c) {
    input.value = c.name;
    matches = []; active = -1; render();
    input.blur();
    go(c.lat, c.lon, c.name);
  }

  input.addEventListener("input", () => { matches = find(input.value); active = matches.length ? 0 : -1; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && matches.length) { active = (active + 1) % matches.length; render(); e.preventDefault(); }
    else if (e.key === "ArrowUp" && matches.length) { active = (active - 1 + matches.length) % matches.length; render(); e.preventDefault(); }
    else if (e.key === "Enter") {
      if (active >= 0) choose(matches[active]);
      else if (input.value.trim()) toast(`No place called "${input.value.trim()}" in the list.`);
    } else if (e.key === "Escape") { matches = []; render(); input.blur(); }
    e.stopPropagation();   // don't trigger the map's Space / arrow shortcuts while typing
  });
  // mousedown (not click) so it fires before the input's blur hides the list
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); choose(matches[+li.dataset.k]); }
  });
  input.addEventListener("blur", () => setTimeout(() => { matches = []; render(); }, 100));

  locBtn.addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Location is not available in this browser.");
    locBtn.classList.add("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locBtn.classList.remove("busy");
        go(pos.coords.latitude, pos.coords.longitude, "Your location");
      },
      (err) => {
        locBtn.classList.remove("busy");
        toast(err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Could not get your location.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}

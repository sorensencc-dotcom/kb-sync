class WeeklyReportingDashboard extends HTMLElement {
  static observedAttributes = ['src'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.load(); }
  attributeChangedCallback() { if (this.isConnected) this.load(); }

  async load() {
    const src = this.getAttribute('src');
    if (!src) return this.renderError('No reporting endpoint configured.');
    try {
      const response = await fetch(src, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'SUCCESS') {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      this.render(payload.data);
    } catch (error) {
      this.renderError(`Weekly telemetry unavailable: ${error.message}`);
    }
  }

  render(data = {}) {
    const m = data.metrics || {};
    const health = data.test_health || {};
    const backlog = data.backlog || {};
    const debt = data.shortcut_debt || {};
    const commit = data.biggest_commit || {};
    const pct = value => `${((Number(value) || 0) * 100).toFixed(0)}%`;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--white,#faf6f0);font-family:var(--font-ui,system-ui,sans-serif)}
      .wrap{background:var(--forge,#1a1410);border:1px solid rgba(196,80,26,.4);padding:1.25rem;border-radius:8px}
      h3{margin:0;color:var(--brass,#b8922a);font-family:var(--font-display,serif);font-size:1.35rem}
      .meta{color:var(--ash,#9a9088);font-size:.75rem;margin:.35rem 0 1rem}.cards,.grid{display:grid;gap:.75rem}.cards{grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}.grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:.75rem}.card,.panel{background:var(--iron,#2c2420);border:1px solid rgba(154,144,136,.18);border-radius:6px;padding:.85rem}.label{color:var(--ash,#9a9088);font-size:.68rem;text-transform:uppercase;letter-spacing:.12em}.value{font-size:1.45rem;font-weight:700;margin-top:.25rem}.sub{color:var(--ash,#9a9088);font-size:.72rem;margin-top:.25rem}.panel h4{color:var(--ember,#c4501a);margin:0 0 .65rem;font-size:.85rem}.row{display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0;border-bottom:1px solid rgba(154,144,136,.12);font-size:.78rem}.row:last-child{border:0}.muted{color:var(--ash,#9a9088)}.bar{height:10px;display:flex;border-radius:5px;overflow:hidden;background:#120e0b;margin:.4rem 0 .7rem}.bar i{display:block;height:100%}.error{border-color:#9b2c2c;background:#321717;color:#f0a0a0;padding:1rem;border-radius:6px;font-size:.85rem}
    </style><div class="wrap"><h3>Weekly Retro Reporting</h3><div class="meta">${data.window || '7d'} · ${data.date || 'date unavailable'} · ${data.version_range?.join(' → ') || 'version unavailable'}</div>
    <div class="cards"><div class="card"><div class="label">Commits</div><div class="value">${m.commits || 0}</div><div class="sub">${m.prs_merged || 0} PRs merged</div></div><div class="card"><div class="label">Net LOC</div><div class="value">+${(m.net_loc || 0).toLocaleString()}</div><div class="sub">+${(m.insertions || 0).toLocaleString()} / -${(m.deletions || 0).toLocaleString()}</div></div><div class="card"><div class="label">Test Ratio</div><div class="value">${pct(m.test_ratio)}</div><div class="sub">${m.test_insertions || 0} test LOC</div></div><div class="card"><div class="label">Streak</div><div class="value">${m.personal_streak_days || 0} days</div><div class="sub">${m.personal_streak_days === 0 ? 'Broken' : 'Active'}</div></div></div>
    <div class="grid"><div class="panel"><h4>Work Distribution</h4><div class="bar"><i style="width:${pct(m.docs_pct)};background:#b8922a"></i><i style="width:${pct(m.feat_pct)};background:#4c9f70"></i><i style="width:${pct(m.chore_pct)};background:#8b6fb0"></i><i style="width:${pct(m.fix_pct)};background:#c4501a"></i><i style="width:${pct(m.test_pct)};background:#c97991"></i></div><div class="row"><span class="muted">Docs / Feat / Chore</span><span>${pct(m.docs_pct)} / ${pct(m.feat_pct)} / ${pct(m.chore_pct)}</span></div><div class="row"><span class="muted">Fix / Test</span><span>${pct(m.fix_pct)} / ${pct(m.test_pct)}</span></div></div><div class="panel"><h4>Session Pacing</h4><div class="row"><span class="muted">Active time</span><span>${m.total_active_minutes || 0} mins · ${m.active_days || 0} days</span></div><div class="row"><span class="muted">Sessions</span><span>${m.deep_sessions || 0} deep / ${m.medium_sessions || 0} med / ${m.micro_sessions || 0} micro</span></div><div class="row"><span class="muted">Focus</span><span>${m.focus_area || '(root)'} · ${m.focus_score || 0}</span></div></div><div class="panel"><h4>Health & Debt</h4><div class="row"><span class="muted">Backlog</span><span>${backlog.total_open || 0} open · ${backlog.p0_p1 || 0} P0/P1</span></div><div class="row"><span class="muted">Shortcut markers</span><span>${debt.markers_found || 0}</span></div><div class="row"><span class="muted">Tests touched</span><span>${health.test_files_changed || 0} / ${health.total_test_files || 0}</span></div></div><div class="panel"><h4>Anchor Commit</h4><div class="row"><span class="muted">Hash</span><span><code>${commit.hash || 'N/A'}</code> · ${commit.loc || 0} LOC</span></div><div class="row"><span class="muted">Subject</span><span>${commit.subject || 'N/A'}</span></div></div></div><div class="sub">${data.tweetable || 'No executive summary supplied.'}</div></div>`;
  }

  renderError(message) { this.shadowRoot.innerHTML = `<style>:host{display:block}.error{border:1px solid #9b2c2c;background:#321717;color:#f0a0a0;padding:1rem;border-radius:6px;font:14px system-ui}</style><div class="error">⚠ ${message}</div>`; }
}

if (!customElements.get('weekly-reporting-dashboard')) customElements.define('weekly-reporting-dashboard', WeeklyReportingDashboard);

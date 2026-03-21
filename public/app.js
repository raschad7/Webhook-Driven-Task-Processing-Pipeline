// --- Global State ---
let pipelines = [];
let activePipeline = null;
let currentTab = 'pipelines';
let ADMIN_API_KEY = localStorage.getItem('PF_ADMIN_KEY');

// --- Initialization ---
async function init() {
    lucide.createIcons();
    if (ADMIN_API_KEY) {
        showApp();
        await fetchPipelines();
        switchTab('pipelines');
    } else {
        showAuth();
    }
}

// --- Auth Handling ---
function handleAuth(e) {
    e.preventDefault();
    const key = document.getElementById('auth-key').value.trim();
    if (key) {
        ADMIN_API_KEY = key;
        localStorage.setItem('PF_ADMIN_KEY', key);
        showApp();
        fetchPipelines();
    }
}

function handleLogout() {
    ADMIN_API_KEY = null;
    localStorage.removeItem('PF_ADMIN_KEY');
    showAuth();
}

function showAuth() {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('app-content').classList.add('opacity-0');
}

function showApp() {
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('app-content').classList.remove('opacity-0');
}

// --- Navigation ---
function switchTab(tab) {
    currentTab = tab;
    document.getElementById('view-pipelines').classList.toggle('hidden', tab !== 'pipelines');
    document.getElementById('view-logs').classList.toggle('hidden', tab !== 'logs');
    
    document.getElementById('tab-btn-pipelines').classList.toggle('tab-active', tab === 'pipelines');
    document.getElementById('tab-btn-logs').classList.toggle('tab-active', tab === 'logs');
    
    if (tab === 'logs') fetchSystemLogs();
    lucide.createIcons();
}

// --- API Wrapper ---
async function authFetch(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { ...options.headers, 'x-api-key': ADMIN_API_KEY }
    });
    if (res.status === 401) {
        handleLogout();
        throw new Error('Unauthorized');
    }
    return res;
}

// --- Pipeline Operations ---
async function fetchPipelines() {
    try {
        const res = await authFetch('/api/pipelines');
        const data = await res.json();
        pipelines = data.data || [];
        renderPipelines();
        if (activePipeline) {
            const updated = pipelines.find(p => p.id === activePipeline.id);
            if (updated) {
                activePipeline = updated;
                updatePipelineUI();
            }
        }
    } catch (err) {
        showToast('Failed to load pipelines', 'error');
    }
}

function renderPipelines() {
    const listEl = document.getElementById('pipeline-list');
    listEl.innerHTML = '';
    
    if (pipelines.length === 0) {
        listEl.innerHTML = '<div class="p-8 text-center text-slate-500 italic text-xs">No pipelines found</div>';
        return;
    }

    pipelines.forEach(p => {
        const isActive = activePipeline && activePipeline.id === p.id;
        const div = document.createElement('div');
        div.className = `p-4 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${isActive ? 'bg-indigo-600 border-indigo-400 shadow-lg' : 'bg-slate-800/40 border-slate-800 hover:border-slate-600'}`;
        div.onclick = () => selectPipeline(p);
        div.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="truncate">
                    <h3 class="font-bold text-sm ${isActive ? 'text-white' : 'text-slate-200'} truncate">${p.name}</h3>
                    <span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isActive ? 'bg-indigo-400/30' : 'bg-slate-700'}">${p.action}</span>
                </div>
                <i data-lucide="chevron-right" class="w-4 h-4 ${isActive ? 'text-white' : 'text-slate-600'}"></i>
            </div>
        `;
        listEl.appendChild(div);
    });
    lucide.createIcons();
}

function selectPipeline(p) {
    activePipeline = p;
    renderPipelines();
    updatePipelineUI();
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('pipeline-details').classList.remove('hidden');
    fetchJobsForCurrent();
}

function updatePipelineUI() {
    document.getElementById('detail-name').innerText = activePipeline.name;
    document.getElementById('detail-action-tag').innerText = activePipeline.action;
    document.getElementById('detail-url').innerText = activePipeline.sourceUrl;
    document.getElementById('detail-created').innerText = `Created ${new Date(activePipeline.createdAt).toLocaleDateString()}`;
}

async function submitPipeline(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    const body = {
        name: document.getElementById('input-name').value,
        action: document.getElementById('action-select').value,
        subscriberUrls: document.getElementById('input-urls').value.split(',').map(u => u.trim()).filter(u => u)
    };
    try {
        const res = await authFetch('/api/pipelines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            showToast('Pipeline Deployed!', 'success');
            closeCreateModal();
            fetchPipelines();
            document.getElementById('create-form').reset();
        }
    } catch (err) { showToast('Deployment failed', 'error'); }
    finally { btn.disabled = false; }
}

async function triggerTest() {
    const btn = document.getElementById('test-btn');
    btn.disabled = true;
    try {
        const slug = activePipeline.sourceUrl.split('/').pop();
        const res = await fetch(`/incoming/${slug}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: document.getElementById('test-payload').value
        });
        if (res.ok) {
            showToast('Webhook sent!', 'success');
            closeTestModal();
            setTimeout(fetchJobsForCurrent, 1500);
        }
    } catch (err) { showToast('Test failed', 'error'); }
    finally { btn.disabled = false; }
}

async function confirmDelete() {
    if (!activePipeline || !confirm(`Delete "${activePipeline.name}"?`)) return;
    try {
        const res = await authFetch(`/api/pipelines/${activePipeline.id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Deleted', 'success');
            activePipeline = null;
            document.getElementById('pipeline-details').classList.add('hidden');
            document.getElementById('empty-state').classList.remove('hidden');
            fetchPipelines();
        }
    } catch (err) { showToast('Error deleting', 'error'); }
}

// --- Job History & Retries ---
async function fetchJobsForCurrent() {
    if (!activePipeline) return;
    try {
        const res = await authFetch(`/api/pipelines/${activePipeline.id}/jobs`);
        const data = await res.json();
        const jobs = data.data || [];
        renderJobs(jobs);
        
        document.getElementById('stat-total-jobs').innerText = jobs.length;
        const failures = jobs.filter(j => j.status === 'failed').length;
        const rate = jobs.length > 0 ? Math.round(((jobs.length - failures) / jobs.length) * 100) : 100;
        document.getElementById('stat-success-rate').innerText = rate + '%';
    } catch (err) { showToast('Error loading jobs', 'error'); }
}

function renderJobs(jobs) {
    const tbody = document.getElementById('jobs-list');
    tbody.innerHTML = '';
    document.getElementById('no-jobs').classList.toggle('hidden', jobs.length > 0);

    jobs.forEach(job => {
        const row = document.createElement('tr');
        row.className = "hover:bg-slate-800/30 transition text-xs";
        
        const isFailed = job.status === 'failed';
        const isProcessing = job.status === 'processing';
        
        row.innerHTML = `
            <td class="p-4">
                <span class="status-pill status-${job.status}">
                    <i data-lucide="${job.status === 'completed' ? 'check-circle' : isFailed ? 'alert-circle' : 'loader'}" class="w-3 h-3 ${isProcessing ? 'animate-spin' : ''}"></i>
                    ${job.status}
                </span>
            </td>
            <td class="p-4 font-mono text-slate-500">${job.id.substring(0,8)}</td>
            <td class="p-4 text-slate-300 truncate max-w-xs">${job.payload.substring(0,60)}...</td>
            <td class="p-4 text-slate-500">${new Date(job.createdAt).toLocaleTimeString()}</td>
            <td class="p-4 text-right">
                <div class="flex items-center justify-end space-x-2">
                    ${isFailed ? `<button onclick="retryJob('${job.id}')" class="p-1.5 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>` : ''}
                    <button onclick="inspectJob('${encodeURIComponent(job.payload)}')" class="p-1.5 hover:bg-slate-700 rounded-lg transition"><i data-lucide="eye" class="w-3.5 h-3.5 text-slate-400"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
    lucide.createIcons();
}

async function retryJob(jobId) {
    try {
        const res = await authFetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
        if (res.ok) {
            showToast('Retry queued!', 'success');
            fetchJobsForCurrent();
        }
    } catch (err) { showToast('Retry failed', 'error'); }
}

function inspectJob(payload) {
    const data = JSON.parse(decodeURIComponent(payload));
    document.getElementById('job-modal-payload').innerText = JSON.stringify(data, null, 2);
    document.getElementById('job-modal').classList.remove('hidden');
}

// --- System Logs ---
async function fetchSystemLogs() {
    try {
        const res = await authFetch('/api/logs');
        const data = await res.json();
        renderLogs(data.data || []);
    } catch (err) { showToast('Error loading logs', 'error'); }
}

function renderLogs(logs) {
    const container = document.getElementById('logs-container');
    container.innerHTML = '';
    logs.forEach(log => {
        const color = log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-emerald-400';
        const div = document.createElement('div');
        div.className = "flex items-start space-x-4 p-2 hover:bg-white/5 transition rounded text-[11px] border-b border-white/[0.03]";
        div.innerHTML = `
            <span class="w-12 font-bold uppercase tracking-tighter ${color}">${log.level}</span>
            <span class="text-slate-500 whitespace-nowrap">${new Date(log.createdAt).toLocaleTimeString()}</span>
            <span class="flex-1 text-slate-200">${log.message}</span>
            <span class="text-slate-600 italic truncate max-w-[200px]">${log.context ? JSON.stringify(log.context) : ''}</span>
        `;
        container.appendChild(div);
    });
}

// --- UI Helpers ---
function openCreateModal() { document.getElementById('create-modal').classList.remove('hidden'); }
function closeCreateModal() { document.getElementById('create-modal').classList.add('hidden'); }
function openTestModal() { document.getElementById('test-modal').classList.remove('hidden'); }
function closeTestModal() { document.getElementById('test-modal').classList.add('hidden'); }
function closeJobModal() { document.getElementById('job-modal').classList.add('hidden'); }
function copyUrl() { navigator.clipboard.writeText(document.getElementById('detail-url').innerText); showToast('Copied!', 'success'); }

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const isError = type === 'error';
    toast.className = `p-4 rounded-xl border-l-4 glass shadow-2xl flex items-center space-x-3 animate-fade ${isError ? 'border-red-500 text-red-400' : 'border-emerald-500 text-emerald-400'}`;
    toast.innerHTML = `<i data-lucide="${isError ? 'alert-circle' : 'check-circle'}" class="w-5 h-5"></i><span class="font-semibold text-sm">${msg}</span>`;
    container.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// --- Bootstrap ---
init();

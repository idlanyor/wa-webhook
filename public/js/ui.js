/* WA Webhook UI helpers (replaces jQuery/Bootstrap/AdminLTE). */
(function () {
    'use strict';

    const swalBase = { confirmButtonColor: '#7c3aed', cancelButtonColor: '#64748b' };

    window.escapeHtml = function (value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    };

    window.showNotification = function (message, type = 'info') {
        const tone = { success: 'alert-success', error: 'alert-danger', warning: 'alert-warning', info: 'alert-info' }[type] || 'alert-info';
        const el = document.createElement('div');
        el.className = `alert ${tone} fixed top-4 right-4 z-50 max-w-sm bg-surface shadow-lg`;
        el.setAttribute('role', 'status');
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    };

    function closeAlert(alert) { if (alert) alert.remove(); }

    document.addEventListener('click', (e) => {
        const close = e.target.closest('[data-dismiss="alert"]');
        if (close) closeAlert(close.closest('.alert'));

        const open = e.target.closest('[data-dialog-open]');
        if (open) document.getElementById(open.dataset.dialogOpen)?.showModal();

        const copy = e.target.closest('[data-copy-target]');
        if (copy) {
            const id = copy.dataset.copyTarget;
            const el = id === 'code-active'
                ? copy.closest('[aria-label]')?.querySelector('[role="tabpanel"]:not([hidden])')
                : document.getElementById(id);
            if (el && navigator.clipboard) {
                navigator.clipboard.writeText(el.textContent.trim()).then(() => showNotification('Disalin ke clipboard', 'success'));
            }
        }

        const shut = e.target.closest('[data-dialog-close]');
        if (shut) shut.closest('dialog')?.close();

        const tab = e.target.closest('[role="tab"][data-tab]');
        if (tab) {
            const list = tab.closest('[role="tablist"]');
            list.querySelectorAll('[role="tab"]').forEach(t => {
                const on = t === tab;
                t.setAttribute('aria-selected', on ? 'true' : 'false');
                const panel = document.getElementById(t.dataset.tab);
                if (panel) panel.hidden = !on;
            });
        }
    });

    // Click on dialog backdrop closes it
    document.addEventListener('click', (e) => {
        if (e.target instanceof HTMLDialogElement && e.target.open) {
            const r = e.target.getBoundingClientRect();
            const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (!inside) e.target.close();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        // Confirm before submitting destructive forms
        document.querySelectorAll('form[data-confirm]').forEach(form => {
            form.addEventListener('submit', async (e) => {
                if (form.dataset.confirmed) return;
                e.preventDefault();
                const result = await Swal.fire({
                    ...swalBase,
                    title: 'Yakin?',
                    text: form.getAttribute('data-confirm') || 'Lanjutkan tindakan ini?',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#b91c1c',
                    confirmButtonText: 'Ya, lanjut',
                    cancelButtonText: 'Batal'
                });
                if (result.isConfirmed) { form.dataset.confirmed = '1'; form.submit(); }
            });
        });

        // Loading state on normal form submit
        document.querySelectorAll('form:not([data-confirm])').forEach(form => {
            form.addEventListener('submit', () => {
                const btn = form.querySelector('button[type="submit"]');
                if (!btn || btn.dataset.noLoading !== undefined) return;
                const html = btn.innerHTML;
                setTimeout(() => { btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Memproses…'; }, 0);
                setTimeout(() => { btn.disabled = false; btn.innerHTML = html; }, 4000);
            });
        });

        // Auto-dismiss flash alerts
        document.querySelectorAll('.alert[data-autoclose]').forEach(a => setTimeout(() => closeAlert(a), 6000));
    });
})();

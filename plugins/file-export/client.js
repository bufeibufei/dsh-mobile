window.__ModuleLoader__.load({
  id: '@jarvis/b0-file-export-client',
  factory: require => {
    const { jsx, jsxs } = require('react/jsx-runtime');
    const { useEffect, useRef, useState } = require('react');
    const LIMIT = 16 * 1024 * 1024;
    const CHUNK = 48 * 1024;
    let current = null;
    const uuid = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
    };
    const channel = () => window.jarvisFileExport;
    const post = (id, method, fields = {}) => channel().postMessage(JSON.stringify({v: 1, requestId: id, method, ...fields}));
    const base64 = bytes => {
      let text = '';
      for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      return btoa(text);
    };
    const finish = (transfer, message) => {
      if (current !== transfer) return;
      current = null;
      transfer.update(message);
    };
    const receive = event => {
      let reply;
      try { reply = JSON.parse(event.data); } catch { return; }
      const transfer = current;
      if (!transfer || reply.v !== 1 || reply.requestId !== transfer.id) return;
      if (reply.status === 'success') {
        finish(transfer, reply.bytesWritten === transfer.bytes.length ? '已保存到所选位置' : '保存失败：长度不一致');
        return;
      }
      if (reply.status === 'cancelled' || reply.status === 'error') {
        const message = reply.status === 'cancelled' ? '已取消保存' : '保存失败：' + (reply.code || '未知错误');
        finish(transfer, message + (reply.partialFileMayRemain ? '；所选位置可能保留不完整文件' : ''));
        return;
      }
      if (transfer.cancelled) return;
      if (reply.status === 'ready') {
        if (transfer.ready || reply.nextSeq !== 0) { transfer.cancelled = true; post(transfer.id, 'cancel'); return; }
        transfer.ready = true;
      } else if (reply.status === 'ack') {
        if (!transfer.ready || reply.nextSeq !== transfer.seq + 1 || reply.bytesWritten !== transfer.offset) {
          transfer.cancelled = true; post(transfer.id, 'cancel'); return;
        }
        transfer.seq++;
      } else return;
      if (transfer.offset === transfer.bytes.length) post(transfer.id, 'commit');
      else {
        const chunk = transfer.bytes.subarray(transfer.offset, transfer.offset + CHUNK);
        transfer.offset += chunk.length;
        post(transfer.id, 'chunk', {seq: transfer.seq, base64: base64(chunk)});
      }
    };
    function apply(ctx) {
      const listener = channel();
      if (!listener) return; // Browser keeps its official UI; Android unsupported notice lives in native shell.
      listener.onmessage = receive;
      ctx.effect(() => () => {
        if (current) { current.cancelled = true; post(current.id, 'cancel'); current = null; }
        if (listener.onmessage === receive) listener.onmessage = null;
      });
      function SaveAction({absolutePath, sessionId}) {
        const [message, setMessage] = useState('');
        const [busy, setBusy] = useState(false);
        const alive = useRef(true);
        const owner = useRef(null);
        useEffect(() => {
          alive.current = true;
          return () => {
          alive.current = false;
          owner.current?.abort();
          if (current?.owner === owner) { current.cancelled = true; post(current.id, 'cancel'); }
          };
        }, []);
        const update = message => { if (alive.current) { setMessage(message); setBusy(false); } };
        const save = async () => {
          if (current || busy) { setMessage('另一个文件正在保存'); return; }
          setBusy(true); setMessage('正在读取文件');
          const controller = new AbortController();
          owner.current = controller;
          try {
            const result = await ctx.remote.workspaceFiles.readBytes(sessionId, absolutePath, {}, controller.signal);
            if (controller.signal.aborted || !alive.current) return;
            if (!result.ok) throw Error('无法读取文件');
            const bytes = result.value.data;
            if (!(bytes instanceof Uint8Array) || bytes.length > LIMIT) throw Error('文件超过保存上限或格式不可用');
            if (current) throw Error('另一个文件正在保存');
            const filename = absolutePath.split(/[\\/]/).pop();
            if (!filename || filename.length > 128) throw Error('文件名不可用');
            current = {id: uuid(), bytes, owner, update, seq: 0, offset: 0, ready: false, cancelled: false};
            setMessage('请选择保存位置');
            post(current.id, 'begin', {filename, mime: 'application/octet-stream', byteLength: bytes.length});
          } catch (error) {
            if (controller.signal.aborted) return;
            if (current?.owner === owner) current = null;
            update(error.message || '保存失败');
          }
        };
        const cancel = () => {
          owner.current?.abort();
          if (current?.owner === owner) { current.cancelled = true; post(current.id, 'cancel'); }
          else update('已取消保存');
        };
        const buttonStyle = {whiteSpace: 'nowrap', flexShrink: 0, fontSize: '12px', lineHeight: '1.3', padding: '4px 6px', borderRadius: '6px'};
        return jsxs('span', {style: {display: 'inline-flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start', maxWidth: '140px'}, children: [
          jsxs('span', {style: {display: 'inline-flex', gap: '4px'}, children: [
            jsx('button', {type: 'button', style: buttonStyle, onClick: save, disabled: busy, 'aria-label': '保存到手机', children: '保存到手机'}),
            busy && jsx('button', {type: 'button', style: buttonStyle, onClick: cancel, children: '取消保存'})
          ]}),
          message && jsx('span', {role: 'status', style: {fontSize: '12px', lineHeight: '1.3', overflowWrap: 'anywhere'}, children: message})
        ]});
      }
      const slot = 'sidebar.right.tab.document.actions';
      ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register({name: slot, id: 'jarvis-save-to-device', order: 20}, SaveAction)));
    }
    return {inject: ['slots', 'remote', 'remote.workspaceFiles'], apply};
  }
});

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function ShellTerminal({ siteId, getToken }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    term.writeln('Connecting to container...');

    let ws;

    (async () => {
      try {
        const token = await getToken();
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${window.location.host}/api/sites/${siteId}/shell?token=${encodeURIComponent(token)}`;
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          term.writeln('Connected.\r\n');
        };

        ws.onmessage = (event) => {
          term.write(event.data);
        };

        ws.onclose = () => {
          term.writeln('\r\n[Connection closed]');
        };

        ws.onerror = () => {
          term.writeln('\r\n[Connection error]');
        };

        term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });
      } catch (err) {
        term.writeln(`\r\n[Auth error: ${err.message}]`);
      }
    })();

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (ws) ws.close();
      term.dispose();
    };
  }, [siteId, getToken]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 400,
        background: '#1e1e1e',
        borderRadius: 8,
        overflow: 'hidden',
        padding: 4,
      }}
    />
  );
}

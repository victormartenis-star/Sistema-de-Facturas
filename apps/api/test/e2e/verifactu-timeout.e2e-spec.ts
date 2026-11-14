import { createServer, Server } from 'node:net';
import { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VerifactuSubmissionService } from '../../src/invoices/verifactu-submission.service';

/**
 * 2.2: el POST a la AEAT no puede quedarse colgado. Un servidor que acepta
 * la conexión y nunca responde debe acabar en rechazo antes de 20 s.
 */
describe('VeriFactu: timeout del envío a la AEAT', () => {
  let servidor: Server;
  const sockets = new Set<import('node:net').Socket>();

  beforeAll(async () => {
    servidor = createServer((s) => {
      sockets.add(s);
      s.on('error', () => undefined);
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  });

  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => servidor.close(() => r()));
    delete process.env.AEAT_CERT_PATH;
    delete process.env.AEAT_CERT_PASSWORD;
    delete process.env.AEAT_ENDPOINT_URL;
  });

  it('rechaza en menos de 20 s si la AEAT no responde', async () => {
    // .p12 autofirmado de usar y tirar (el handshake nunca llega a completarse).
    const dir = mkdtempSync(join(tmpdir(), 'aeat-timeout-'));
    const pfx = join(dir, 'cert.p12');
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      join(dir, 'k.pem'),
      '-out',
      join(dir, 'c.pem'),
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=Test',
    ]);
    execFileSync('openssl', [
      'pkcs12',
      '-export',
      '-inkey',
      join(dir, 'k.pem'),
      '-in',
      join(dir, 'c.pem'),
      '-out',
      pfx,
      '-passout',
      'pass:x',
    ]);
    const { port } = servidor.address() as AddressInfo;
    process.env.AEAT_CERT_PATH = pfx;
    process.env.AEAT_CERT_PASSWORD = 'x';
    process.env.AEAT_ENDPOINT_URL = `https://127.0.0.1:${port}/verifactu`;

    const svc = new VerifactuSubmissionService(
      {} as never,
      {} as never,
      {} as never,
    );
    const inicio = Date.now();
    await expect(
      (svc as unknown as { postToAeat(xml: string): Promise<void> }).postToAeat(
        '<x/>',
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(Date.now() - inicio).toBeLessThan(20_000);
    rmSync(dir, { recursive: true, force: true });
  }, 40_000);
});

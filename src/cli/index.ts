import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import { CapturezeClient } from '../lib/client.ts';
import { loadConfig } from '../lib/config.ts';
import { ensureSiteForUrl } from '../lib/ensure-site.ts';
import { describeCapture, describeSchedule, resolveCaptureUrl } from '../lib/format.ts';
import { CapturezeApiError, CapturezeTimeoutError } from '../lib/errors.ts';
import { SERVER_VERSION } from '../server.ts';

/**
 * A CLI over the same client, ensure-site and formatting code the MCP tools
 * use. It exists so a human can reproduce, by hand, exactly what an agent did —
 * which is the fastest way to tell "the agent asked for the wrong thing" apart
 * from "the API misbehaved".
 */

/** Commands that make `captureze-mcp <cmd>` run the CLI instead of the server. */
export const CLI_COMMANDS = [
  'account',
  'capture',
  'capture-site',
  'captures',
  'certificate',
  'compare',
  'consent',
  'delete-site',
  'monitor',
  'runs',
  'site',
  'sites',
] as const;

export function isCliInvocation(argv: string[]): boolean {
  const first = argv.find((arg) => !arg.startsWith('-'));
  return first !== undefined && (CLI_COMMANDS as readonly string[]).includes(first);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function client(): CapturezeClient {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error(
      'CAPTUREZE_API_KEY is not set. Put it in the environment or in a .env file next to where you run this.',
    );
  }
  return CapturezeClient.fromConfig(config, config.apiKey);
}

/** Downloads the capture to --out, or reports where it is stored. */
async function deliverImage(
  api: CapturezeClient,
  capture: Awaited<ReturnType<CapturezeClient['capture']>>,
  out: string | undefined,
): Promise<void> {
  const url = resolveCaptureUrl(capture, api.baseUrl);
  if (!out || !url) return;
  const image = await api.downloadImage(url);
  await writeFile(out, Buffer.from(image.data, 'base64'));
  process.stderr.write(`saved ${image.bytes} bytes to ${out}\n`);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('captureze-mcp')
    .description('Captureze MCP server, and a CLI over the same tools')
    .version(SERVER_VERSION);

  program
    .command('capture')
    .description('capture a URL now (same path as the captureze_capture_url tool)')
    .argument('<url>', 'page to capture')
    .option('--full-page', 'capture the whole scrollable page')
    .option('--viewport <preset>', 'desktop | laptop | tablet | mobile')
    .option('--format <format>', 'png | jpeg | pdf')
    .option('--country <code>', 'capture from this country, e.g. DE')
    .option('--city <city>', 'capture from this city (requires --country)')
    .option('--monitor', 'keep capturing on a schedule')
    .option('--cron <expression>', 'schedule to use with --monitor')
    .option('--out <file>', 'write the image to this file')
    .action(async (url: string, options: Record<string, string | boolean | undefined>) => {
      const api = client();
      const { schedule, created } = await ensureSiteForUrl({
        client: api,
        url,
        monitor: Boolean(options.monitor),
        ...(typeof options.cron === 'string' ? { cronExpression: options.cron } : {}),
        settings: {
          ...(options.fullPage ? { full_page: true } : {}),
          ...(typeof options.viewport === 'string' ? { viewport_preset: options.viewport } : {}),
          ...(typeof options.format === 'string' ? { output_format: options.format } : {}),
          ...(typeof options.country === 'string' ? { geo_country: options.country } : {}),
          ...(typeof options.city === 'string' ? { geo_city: options.city } : {}),
        },
      });
      const capture = await api.capture(schedule.id);
      await deliverImage(api, capture, options.out as string | undefined);
      print({
        site_created: created,
        site: describeSchedule(schedule),
        ...describeCapture(capture, api.baseUrl),
      });
    });

  program
    .command('capture-site')
    .description('capture an existing site with its stored settings')
    .argument('<site-id>')
    .option('--out <file>', 'write the image to this file')
    .action(async (siteId: string, options: { out?: string }) => {
      const api = client();
      const capture = await api.capture(siteId);
      await deliverImage(api, capture, options.out);
      print(describeCapture(capture, api.baseUrl));
    });

  program
    .command('sites')
    .description('list monitored sites')
    .action(async () => {
      const api = client();
      print((await api.listSchedules()).map(describeSchedule));
    });

  program
    .command('site')
    .description('show one site in full')
    .argument('<site-id>')
    .action(async (siteId: string) => {
      print(await client().getSchedule(siteId));
    });

  program
    .command('monitor')
    .description('start capturing a page on a schedule')
    .argument('<url>')
    .requiredOption('--cron <expression>', '5-field cron, e.g. "0 9 * * *"')
    .option('--name <name>', 'display name')
    .option('--timezone <zone>', 'IANA zone the cron is written in')
    .action(async (url: string, options: { cron: string; name?: string; timezone?: string }) => {
      const api = client();
      const { schedule } = await ensureSiteForUrl({
        client: api,
        url,
        monitor: true,
        cronExpression: options.cron,
        ...(options.name ? { name: options.name } : {}),
        settings: { ...(options.timezone ? { timezone: options.timezone } : {}) },
      });
      print(describeSchedule(schedule));
    });

  program
    .command('delete-site')
    .description('delete a site and its capture history')
    .argument('<site-id>')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (siteId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        throw new Error(`This deletes ${siteId} and every capture under it. Re-run with --yes.`);
      }
      await client().deleteSchedule(siteId);
      print({ deleted_site_id: siteId });
    });

  program
    .command('captures')
    .description('capture history of a site')
    .argument('<site-id>')
    .option('--limit <n>', 'how many', '10')
    .action(async (siteId: string, options: { limit: string }) => {
      const api = client();
      const captures = await api.listScreenshots(siteId, Number.parseInt(options.limit, 10));
      print(captures.map((capture) => describeCapture(capture, api.baseUrl)));
    });

  program
    .command('runs')
    .description('execution log of a site')
    .argument('<site-id>')
    .option('--limit <n>', 'how many', '20')
    .action(async (siteId: string, options: { limit: string }) => {
      print(await client().listExecutions(siteId, Number.parseInt(options.limit, 10)));
    });

  program
    .command('compare')
    .description('pixel-diff two captures')
    .argument('<capture-id-1>')
    .argument('<capture-id-2>')
    .action(async (first: string, second: string) => {
      print(await client().compareScreenshots(first, second));
    });

  program
    .command('certificate')
    .description('Certificate of Capture for a capture')
    .argument('<capture-id>')
    .action(async (captureId: string) => {
      print(await client().getCertificate(captureId));
    });

  program
    .command('consent')
    .description('detect the cookie consent banner on a page')
    .argument('<url>')
    .option('--country <code>', 'probe from this country')
    .action(async (url: string, options: { country?: string }) => {
      print(
        await client().detectConsent({ url, ...(options.country ? { geo_country: options.country } : {}) }),
      );
    });

  program
    .command('account')
    .description('plan, entitlements and usage')
    .action(async () => {
      print(await client().getBilling());
    });

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CapturezeApiError) {
      process.stderr.write(`${error.toString()}\n`);
    } else if (error instanceof CapturezeTimeoutError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  }
}

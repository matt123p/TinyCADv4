import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveLayoutApp } from './serve-app.mjs';
import { installElectronBridge } from '../chat-browser/electron-bridge.mjs';

const root = new URL('../../../', import.meta.url);
for (const target of ['filesystem', 'electron'])
  test.describe(target, () => {
    let app;

    test.beforeAll(async () => {
      test.setTimeout(120000);
      app = await serveLayoutApp('layout-browser', target);
    });
    test.afterAll(async () => {
      await app?.close();
    });

    test('bundled symbols use the offline picker and retain the linked model after reopening', async ({
      page,
      context,
    }) => {
      if (target === 'electron') await installElectronBridge(page);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/bundled-libraries/**', async (route) => {
        const relative = new URL(route.request().url()).pathname.split(
          '/bundled-libraries/',
        )[1];
        await route.fulfill({
          body: await readFile(new URL('bundled-libraries/' + relative, root)),
          contentType: relative.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream',
        });
      });
      await page.goto(app.baseURL);
      await page.evaluate(() => window.layoutTest.placeSpiceSymbol('Resistor'));
      await page.getByRole('tab', { name: 'SPICE', exact: true }).click();
      await page.getByRole('radio', { name: 'Bundled' }).check();
      await page.getByRole('button', { name: 'Find SPICE model…' }).click();
      await expect(page.getByText('No bundled SPICE models are compatible with this symbol.')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Find SPICE model' })).toBeHidden();
      await page.evaluate(() =>
        window.layoutTest.placeSpiceSymbol('LED (yellow)'),
      );
      const spiceTab = page.getByRole('tab', { name: 'SPICE', exact: true });
      await spiceTab.click();
      await page.getByRole('radio', { name: 'Bundled' }).check();
      const findModel = page.getByRole('button', { name: 'Find SPICE model…' });
      await expect(findModel).toBeVisible();
      await context.setOffline(true);
      await findModel.click();
      const dialog = page.getByRole('dialog', { name: 'Find SPICE model' });
      const size = () => dialog.evaluate(({ offsetWidth, offsetHeight }) => [offsetWidth, offsetHeight]);
      const search = dialog.getByRole('textbox', {
        name: 'Part number, alias or device family',
      });
      await expect(search).toBeFocused();
      const initialSize = await size();
      const select = dialog.getByRole('button', { name: 'Select SPICE model' });
      await expect(select).toBeDisabled();
      await search.fill('LED_RED_OJ');
      await expect(dialog.getByRole('status')).toHaveText(
        'No compatible model matches this search.',
      );
      expect(await size()).toEqual(initialSize);
      await search.fill('yellow');
      await dialog
        .getByRole('row', { name: /LED_YELLOW/ })
        .getByRole('cell', { name: 'circsim' })
        .click();
      await expect(dialog.getByText('anode → pin 1')).toBeVisible();
      await expect(dialog.getByText('cathode → pin 2')).toBeVisible();
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await expect(
        dialog.getByRole('link', { name: 'circsim' }),
      ).toHaveAttribute('href', /circsim\/blob\/.+discrete-extra\.lib#L54$/);
      await expect(dialog.locator('pre')).toHaveCount(0);
      await dialog.getByText('View SPICE definition').click();
      await expect(dialog.locator('pre')).toContainText('.model LED_YELLOW');
      expect(await size()).toEqual(initialSize);
      await select.click();
      await expect(
        page.getByRole('button', { name: 'Remove attached model' }),
      ).toBeVisible();
      await context.setOffline(false);
      const xml = await page.evaluate(() => window.layoutTest.saveAndReopen());
      expect(xml).toContain('SPICE_MODEL_PACKS');
      await page.evaluate(() => window.layoutTest.selectSymbol('LED (yellow)'));
      await expect(
        page.getByRole('button', { name: 'Remove attached model' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'circsim' })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test('library symbol editor saves a linked definition and placed overrides copy it into Custom', async ({ page }) => {
      if (target === 'electron') await installElectronBridge(page);
      await page.route('**/bundled-libraries/**', async (route) => {
        const relative = new URL(route.request().url()).pathname.split('/bundled-libraries/')[1];
        await route.fulfill({
          body: await readFile(new URL('bundled-libraries/' + relative, root)),
          contentType: relative.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        });
      });
      await page.goto(app.baseURL);
      await page.evaluate(() => window.layoutTest.editLibrarySymbol('741 op-amp'));
      await page.getByRole('tab', { name: /^spice$/i }).click();
      await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked();
      const dialog = page.getByRole('dialog', { name: 'Find SPICE model' });
      const attach = async () => {
        await page.getByRole('radio', { name: 'Bundled' }).check();
        await page.getByRole('button', { name: 'Find SPICE model…' }).click();
        await dialog.getByRole('textbox').fill('LTC1044HV');
        if (target === 'electron') {
          await dialog.getByRole('button', { name: 'LTC1044HV', exact: true }).click();
          await expect(dialog.getByRole('link', { name: 'special_models/LTC1044.lib' }))
            .toHaveAttribute('href', 'https://ngspice.sourceforge.io/model-parameters/special_models.zip');
        } else {
          await expect(dialog.getByRole('status')).toHaveText('No models match this search.');
        }
        await dialog.getByRole('textbox').fill('LM741');
        await dialog.getByRole('button', { name: 'LM741', exact: true }).press('Enter');
        for (const [terminal, pin] of [
          ['non-inverting input', '3'], ['inverting input', '2'], ['output', '6'],
          ['positive supply', '7'], ['negative supply', '4'],
        ]) {
          await dialog.getByRole('combobox', { name: terminal, exact: true }).selectOption(pin);
        }
        await dialog.getByRole('button', { name: 'Select SPICE model' }).click();
        await expect(dialog).toBeHidden();
      };
      await attach();
      await page.getByText('View SPICE definition').click();
      await expect(page.locator('pre')).toContainText('.subckt opamp_core');
      const prologue = page.getByRole('textbox', { name: /prologue/i });
      await page.getByRole('radio', { name: 'Custom' }).check();
      await expect(prologue).toHaveValue(/\.subckt TC_CUSTOM_LM741_\$\(ref\)/);
      await page.getByRole('radio', { name: 'Bundled' }).check();
      await expect(page.getByRole('link', { name: 'circsim' })).toBeVisible();
      await page.evaluate(() => window.layoutTest.saveLibraryAndPlaceSymbol());
      await page.getByRole('tab', { name: 'SPICE', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Bundled' })).toBeChecked();
      await page.getByRole('radio', { name: 'Custom' }).check();
      await expect(prologue).toHaveValue(/\.subckt TC_CUSTOM_opamp_core_\$\(ref\)/);
      const copied = await prologue.inputValue();
      await prologue.fill(copied + '\n* Instance edit');
      const xml = await page.evaluate(() => window.layoutTest.saveAndReopen());
      expect(xml).toContain('Instance edit');
      await page.evaluate(() => window.layoutTest.selectSymbol('741 op-amp'));
      await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked();
      await expect(prologue).toHaveValue(/Instance edit/);
      await page.getByRole('radio', { name: 'Bundled' }).check();
      await expect(page.getByRole('link', { name: 'circsim' })).toBeVisible();
      await expect(prologue).toBeHidden();
      await page.getByRole('radio', { name: 'Custom' }).check();
      await expect(prologue).toHaveValue(/Instance edit/);
    });
  });

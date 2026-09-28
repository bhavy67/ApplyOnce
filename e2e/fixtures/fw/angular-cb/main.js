import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

const MODES = [{ value: 'r', label: 'Remote' }, { value: 'h', label: 'Hybrid' }, { value: 'o', label: 'On-site' }];
const TYPES = [{ value: 'ft', label: 'Full time' }, { value: 'pt', label: 'Part time' }, { value: 'c', label: 'Contract' }];
const NOTICE = [{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }];

class App {
  s = { firstName: '', mode: '', etype: '', notice: '60', role: '' };
  open = { mode: false, etype: false, notice: false, role: false };
  modeKeys = [0];
  submitted = false;
  lists = { mode: MODES, etype: TYPES, notice: NOTICE, role: TYPES };
  labelOf(key) { return this.lists[key].find((o) => o.value === this.s[key])?.label ?? ''; }
  toggle(key) { this.open[key] = !this.open[key]; }
  close(key) { this.open[key] = false; }
  choose(key, value) { this.s[key] = value; this.open[key] = false; }
  rerender() { this.modeKeys = [this.modeKeys[0] + 1]; }
  state() { return JSON.stringify(this.s); }
}

const buttonDropdown = (key, label) => `
  <div class="field">
    <label id="${key}-label" for="${key}">${label}</label>
    <button type="button" id="${key}" aria-haspopup="listbox" [attr.aria-expanded]="open.${key}" aria-controls="${key}-listbox" aria-labelledby="${key}-label ${key}" (click)="toggle('${key}')" (keydown.escape)="close('${key}')">{{ labelOf('${key}') || 'Select…' }}</button>
    @if (open.${key}) {
      <ul role="listbox" id="${key}-listbox">
        @for (o of lists.${key}; track o.value) {
          <li role="option" [attr.data-value]="o.value" [attr.aria-selected]="o.value === s.${key}" (click)="choose('${key}', o.value)">{{ o.label }}</li>
        }
      </ul>
    }
  </div>`;

Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
<form (ngSubmit)="submitted = true">
  <div class="field"><label for="first">First Name</label><input id="first" name="firstName" [(ngModel)]="s.firstName"></div>
  @for (k of modeKeys; track k) { ${buttonDropdown('mode', 'Work Mode')} }
  <div class="field">
    <label id="etype-label" for="etype">Employment Type</label>
    <input id="etype" role="combobox" aria-autocomplete="list" [attr.aria-expanded]="open.etype" [attr.aria-controls]="open.etype ? 'etype-listbox' : null" [value]="labelOf('etype')" (mousedown)="toggle('etype')" (keydown.escape)="close('etype')">
    @if (open.etype) {
      <ul role="listbox" id="etype-listbox">
        @for (o of lists.etype; track o.value) {
          <li role="option" [attr.data-value]="o.value" [attr.aria-selected]="o.value === s.etype" (click)="choose('etype', o.value)">{{ o.label }}</li>
        }
      </ul>
    }
  </div>
  ${buttonDropdown('notice', 'Notice Period')}
  ${buttonDropdown('role', 'What kind of role are you looking for?')}
  <button type="button" id="rerender" (click)="rerender()">Re-render work mode</button>
  <button type="submit">Submit</button>
  <pre id="state">{{ state() }}</pre>
  <p id="submitted">{{ submitted }}</p>
</form>`,
})(App);

bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }).catch((error) => {
  document.body.insertAdjacentHTML('beforeend', `<p id="bootstrap-error">${String(error)}</p>`);
});

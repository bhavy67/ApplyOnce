import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { FIELDS, search } from '../search-data.js';

// Workday-style prompts with ngModel inputs; the chosen suggestion is written into the input
// and also marked aria-selected in the (inline) list until it closes.
class App {
  fields = FIELDS;
  s = signal({ firstName: '', school: '', study: '', city: '' });
  query = signal({ school: '', study: '', city: '' });
  results = signal({ school: null, study: null, city: null });
  ui = signal({ nav: 0, submitted: false });
  requests = { school: 0, study: 0, city: 0 };
  setFirst(v) { this.s.update((s) => ({ ...s, firstName: v })); }
  async onQuery(key, q) {
    this.query.update((x) => ({ ...x, [key]: q }));
    this.s.update((s) => ({ ...s, [key]: '' }));
    const n = ++this.requests[key];
    if (!q) return this.results.update((r) => ({ ...r, [key]: null }));
    const found = await search(key, q);
    if (n === this.requests[key]) this.results.update((r) => ({ ...r, [key]: found }));
  }
  choose(key, value) {
    this.requests[key]++;
    this.query.update((x) => ({ ...x, [key]: value }));
    this.s.update((s) => ({ ...s, [key]: value }));
    this.results.update((r) => ({ ...r, [key]: null }));
  }
  close(key) { this.results.update((r) => ({ ...r, [key]: null })); }
  state() { return JSON.stringify(this.s()); }
}

Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
<form (ngSubmit)="ui.update((u) => ({ nav: u.nav, submitted: true }))">
  <div data-automation-id="applyFlowPage">
    <div data-automation-id="formField-legalName-firstName"><label for="first">First Name</label><input id="first" name="first" data-automation-id="legalName-firstName" [ngModel]="s().firstName" (ngModelChange)="setFirst($event)"></div>
    @for (f of fields; track f[0]) {
      <div [attr.data-automation-id]="'formField-' + f[0]">
        <label [attr.for]="f[0] + '-input'">{{ f[1] }}</label>
        <input [id]="f[0] + '-input'" [name]="f[0]" [attr.data-automation-id]="f[0]" data-uxi-widget-type="selectinput" role="combobox" aria-autocomplete="list" [attr.aria-expanded]="results()[f[0]] !== null" [attr.aria-controls]="results()[f[0]] !== null ? f[0] + '-list' : null" [ngModel]="query()[f[0]]" (ngModelChange)="onQuery(f[0], $event)" (keydown.escape)="close(f[0])">
        @if (results()[f[0]] !== null) {
          <ul role="listbox" [id]="f[0] + '-list'" data-automation-id="activeListContainer">
            @for (r of results()[f[0]]; track r) {
              <li role="option" data-automation-id="promptOption" [attr.aria-selected]="s()[f[0]] === r" (click)="choose(f[0], r)">{{ r }}</li>
            }
          </ul>
        }
      </div>
    }
    <button type="button" data-automation-id="pageFooterNextButton" (click)="ui.update((u) => ({ nav: u.nav + 1, submitted: u.submitted }))">Save and Continue</button>
    <button type="submit" data-automation-id="submitButton">Submit</button>
  </div>
  <pre id="state">{{ state() }}</pre>
  <p id="nav">{{ ui().nav }}</p>
  <p id="submitted">{{ ui().submitted }}</p>
</form>`,
})(App);

bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }).catch((error) => {
  document.body.insertAdjacentHTML('beforeend', `<p id="bootstrap-error">${String(error)}</p>`);
});

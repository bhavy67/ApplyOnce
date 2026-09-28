import '@angular/compiler'; // JIT: templates are compiled in the browser.
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

class App {
  s = { firstName: '', email: '', phone: '', years: null, city: 'Prefilled Town', linkedin: '', github: '', portfolio: '', postal: '', mode: '', etype: '', relocate: false, cover: '', company: '', referral: '', locations: [] };
  ui = { github: true, portfolioKeys: [0], postal: false, submitted: false };
  cities = ['Ahmedabad', 'Mumbai', 'Bengaluru'];
  toggleLocation(city, checked) {
    this.s.locations = checked ? [...this.s.locations, city] : this.s.locations.filter((x) => x !== city);
  }
  replacePortfolio() {
    this.ui.portfolioKeys = [this.ui.portfolioKeys[0] + 1];
  }
  state() {
    return JSON.stringify(this.s);
  }
}

Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
<form (ngSubmit)="ui.submitted = true">
  <div class="field"><label for="first">First Name *</label><input id="first" name="firstName" [(ngModel)]="s.firstName"></div>
  <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" name="email" [(ngModel)]="s.email"></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" name="phone" [(ngModel)]="s.phone"></div>
  <div class="field"><label for="years">Years of Experience</label><input id="years" type="number" name="years" [(ngModel)]="s.years"></div>
  <div class="field"><label for="city">City</label><input id="city" name="city" [(ngModel)]="s.city"></div>
  <div class="field"><label for="linkedin">LinkedIn URL</label><input id="linkedin" type="url" name="linkedin" [(ngModel)]="s.linkedin"></div>
  @if (ui.github) {
    <div class="field"><label for="github">GitHub</label><input id="github" type="url" name="github" [(ngModel)]="s.github"></div>
  }
  @for (k of ui.portfolioKeys; track k) {
    <div class="field"><label for="portfolio">Portfolio</label><input id="portfolio" type="url" name="portfolio" [(ngModel)]="s.portfolio"></div>
  }
  @if (ui.postal) {
    <div class="field"><label for="postal">Postal Code</label><input id="postal" name="postal" [(ngModel)]="s.postal"></div>
  }
  <div class="field"><label for="mode">Work Mode</label>
    <select id="mode" name="mode" [(ngModel)]="s.mode"><option value="">Select…</option><option value="r">Remote</option><option value="h">Hybrid</option><option value="o">On site</option></select></div>
  <fieldset><legend>Employment Type</legend>
    <label><input type="radio" name="etype" value="ft" [(ngModel)]="s.etype"> Full time</label>
    <label><input type="radio" name="etype" value="pt" [(ngModel)]="s.etype"> Part time</label>
    <label><input type="radio" name="etype" value="c" [(ngModel)]="s.etype"> Contract</label>
  </fieldset>
  <label><input type="checkbox" name="relocate" [(ngModel)]="s.relocate"> Willing to relocate</label>
  <div class="field"><label for="cover">Why do you want to work here?</label><textarea id="cover" name="cover" [(ngModel)]="s.cover"></textarea></div>
  <div class="field"><label for="company">Company</label><input id="company" name="company" [(ngModel)]="s.company"></div>
  <div class="field"><label for="referral">Referral code</label><input id="referral" name="referral" [(ngModel)]="s.referral"></div>
  <fieldset><legend>Preferred locations</legend>
    @for (c of cities; track c) {
      <label><input type="checkbox" name="loc" [value]="c" (change)="toggleLocation(c, $any($event.target).checked)"> {{ c }}</label>
    }
  </fieldset>
  <button type="button" id="remove-github" (click)="ui.github = false">Remove GitHub</button>
  <button type="button" id="replace-portfolio" (click)="replacePortfolio()">Replace portfolio</button>
  <button type="button" id="add-postal" (click)="ui.postal = true">Add postal code</button>
  <button type="submit">Submit application</button>
  <pre id="state">{{ state() }}</pre>
  <p id="submitted">{{ ui.submitted }}</p>
</form>`,
})(App);

bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }).catch((error) => {
  document.body.insertAdjacentHTML('beforeend', `<p id="bootstrap-error">${String(error)}</p>`);
});

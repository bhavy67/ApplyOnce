import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

let generated = 0;
class App {
  s = signal({ degree_undergrad: '', degree_postgrad: '', institution: '' });
  swapped = signal(false);
  renders = signal([0]);
  submitted = signal(false);
  names() { return this.swapped() ? ['degree_postgrad', 'degree_undergrad'] : ['degree_undergrad', 'degree_postgrad']; }
  // Generated ids ("mat-input-7"), new on every re-render.
  idFor = new Map();
  id(name, render) { const key = `${name}|${render}`; if (!this.idFor.has(key)) this.idFor.set(key, `mat-input-${++generated}`); return this.idFor.get(key); }
  set(name, value) { this.s.update((s) => ({ ...s, [name]: value })); }
  state() { return JSON.stringify(this.s()); }
}
Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
<form (ngSubmit)="submitted.set(true)">
  @for (r of renders(); track r) {
    <section>
      <h2>Education</h2>
      @for (name of names(); track name) {
        <p><label [attr.for]="id(name, r)">Degree</label><input [id]="id(name, r)" [attr.name]="name" [ngModelOptions]="{ standalone: true }" [ngModel]="s()[name]" (ngModelChange)="set(name, $event)"></p>
      }
      <p><label for="inst">Institution</label><input id="inst" name="institution" [ngModel]="s().institution" (ngModelChange)="set('institution', $event)"></p>
    </section>
  }
  <button type="button" id="swap" (click)="swapped.set(!swapped())">Swap</button>
  <button type="button" id="rerender" (click)="renders.set([renders()[0] + 1])">Re-render</button>
  <button type="submit">Submit</button>
  <pre id="state">{{ state() }}</pre>
  <p id="submitted">{{ submitted() }}</p>
</form>`,
})(App);
bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }).catch((error) => {
  document.body.insertAdjacentHTML('beforeend', `<p id="bootstrap-error">${String(error)}</p>`);
});

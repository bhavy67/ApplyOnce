import { createApp, reactive } from 'vue';

const template = `
<form @submit.prevent="ui.submitted = true">
  <div class="field"><label for="first">First Name *</label><input id="first" name="firstName" v-model="s.firstName"></div>
  <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" name="email" v-model="s.email"></div>
  <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" name="phone" v-model="s.phone"></div>
  <div class="field"><label for="years">Years of Experience</label><input id="years" type="number" name="years" v-model="s.years"></div>
  <div class="field"><label for="city">City</label><input id="city" name="city" v-model="s.city"></div>
  <div class="field"><label for="linkedin">LinkedIn URL</label><input id="linkedin" type="url" name="linkedin" v-model="s.linkedin"></div>
  <div class="field" v-if="ui.github"><label for="github">GitHub</label><input id="github" type="url" name="github" v-model="s.github"></div>
  <div class="field" :key="'portfolio-' + ui.portfolioKey"><label for="portfolio">Portfolio</label><input id="portfolio" type="url" name="portfolio" v-model="s.portfolio"></div>
  <div class="field" v-if="ui.postal"><label for="postal">Postal Code</label><input id="postal" name="postal" v-model="s.postal"></div>
  <div class="field"><label for="mode">Work Mode</label>
    <select id="mode" name="mode" v-model="s.mode"><option value="">Select…</option><option value="r">Remote</option><option value="h">Hybrid</option><option value="o">On site</option></select></div>
  <fieldset><legend>Employment Type</legend>
    <label><input type="radio" name="etype" value="ft" v-model="s.etype"> Full time</label>
    <label><input type="radio" name="etype" value="pt" v-model="s.etype"> Part time</label>
    <label><input type="radio" name="etype" value="c" v-model="s.etype"> Contract</label>
  </fieldset>
  <label><input type="checkbox" name="relocate" v-model="s.relocate"> Willing to relocate</label>
  <div class="field"><label for="cover">Why do you want to work here?</label><textarea id="cover" name="cover" v-model="s.cover"></textarea></div>
  <div class="field"><label for="company">Company</label><input id="company" name="company" v-model="s.company"></div>
  <div class="field"><label for="referral">Referral code</label><input id="referral" name="referral" v-model="s.referral"></div>
  <fieldset><legend>Preferred locations</legend>
    <label v-for="l in ['Ahmedabad', 'Mumbai', 'Bengaluru']" :key="l"><input type="checkbox" name="loc" :value="l" v-model="s.locations"> {{ l }}</label>
  </fieldset>
  <button type="button" id="remove-github" @click="ui.github = false">Remove GitHub</button>
  <button type="button" id="replace-portfolio" @click="ui.portfolioKey++">Replace portfolio</button>
  <button type="button" id="add-postal" @click="ui.postal = true">Add postal code</button>
  <button type="submit">Submit application</button>
  <pre id="state">{{ JSON.stringify(s) }}</pre>
  <p id="submitted">{{ ui.submitted }}</p>
</form>`;

createApp({
  template,
  setup() {
    const s = reactive({ firstName: '', email: '', phone: '', years: '', city: 'Prefilled Town', linkedin: '', github: '', portfolio: '', postal: '', mode: '', etype: '', relocate: false, cover: '', company: '', referral: '', locations: [] });
    const ui = reactive({ github: true, portfolioKey: 0, postal: false, submitted: false });
    return { s, ui, JSON };
  },
}).mount('#app');

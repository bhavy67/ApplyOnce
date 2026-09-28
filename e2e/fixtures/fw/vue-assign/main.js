import { createApp, reactive } from 'vue';

let generated = 0;
createApp({
  setup() {
    const s = reactive({ degree_undergrad: '', degree_postgrad: '', institution: '' });
    const ui = reactive({ swapped: false, key: 0, submitted: false });
    // Generated ids ("v-12"), new on every re-render.
    const nextId = () => `v-${++generated}`;
    return { s, ui, nextId, JSON };
  },
  template: `
  <form @submit.prevent="ui.submitted = true">
    <section :key="ui.key">
      <h2>Education</h2>
      <p v-for="name in (ui.swapped ? ['degree_postgrad', 'degree_undergrad'] : ['degree_undergrad', 'degree_postgrad'])" :key="name + ui.key">
        <template v-for="id in [nextId()]" :key="id"><label :for="id">Degree</label><input :id="id" :name="name" v-model="s[name]"></template>
      </p>
      <p><label for="inst">Institution</label><input id="inst" name="institution" v-model="s.institution"></p>
    </section>
    <button type="button" id="swap" @click="ui.swapped = !ui.swapped">Swap</button>
    <button type="button" id="rerender" @click="ui.key++">Re-render</button>
    <button type="submit">Submit</button>
    <pre id="state">{{ JSON.stringify(s) }}</pre>
    <p id="submitted">{{ ui.submitted }}</p>
  </form>`,
}).mount('#app');

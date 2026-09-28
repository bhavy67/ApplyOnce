import { createApp, reactive, ref, computed } from 'vue';
import { FIELDS, search } from '../search-data.js';

// Workday-style prompt that shows the chosen suggestion as a selected-item pill and clears the input.
const SearchField = {
  props: ['auto', 'label', 'modelValue'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const query = ref('');
    const results = ref(null);
    let request = 0;
    const open = computed(() => results.value !== null);
    const onInput = async (e) => {
      query.value = e.target.value;
      const n = ++request;
      if (!query.value) { results.value = null; return; }
      const found = await search(props.auto, query.value);
      if (n === request) results.value = found;
    };
    const choose = (value) => { emit('update:modelValue', value); query.value = ''; results.value = null; request++; };
    return { query, results, open, onInput, choose };
  },
  template: `
  <div :data-automation-id="'formField-' + auto">
    <label :for="auto + '-input'">{{ label }}</label>
    <div v-if="modelValue" data-automation-id="selectedItem">{{ modelValue }}</div>
    <input :id="auto + '-input'" :data-automation-id="auto" data-uxi-widget-type="selectinput" role="combobox" aria-autocomplete="list" :aria-expanded="String(open)" :aria-controls="auto + '-list'" :value="query" @input="onInput" @keydown.esc="results = null">
    <Teleport to="body">
      <ul v-if="open" role="listbox" :id="auto + '-list'" data-automation-id="activeListContainer">
        <li v-for="r in results" :key="r" role="option" data-automation-id="promptOption" @click="choose(r)">{{ r }}</li>
      </ul>
    </Teleport>
  </div>`,
};

createApp({
  components: { SearchField },
  setup() {
    const s = reactive({ firstName: '', school: '', study: '', city: '' });
    const ui = reactive({ nav: 0, submitted: false, key: 0 });
    return { s, ui, FIELDS, JSON };
  },
  template: `
  <form @submit.prevent="ui.submitted = true">
    <div data-automation-id="applyFlowPage">
      <div data-automation-id="formField-legalName-firstName"><label for="first">First Name</label><input id="first" data-automation-id="legalName-firstName" v-model="s.firstName"></div>
      <SearchField v-for="[auto, label] in FIELDS" :key="auto + '-' + ui.key" :auto="auto" :label="label" v-model="s[auto]" />
      <button type="button" data-automation-id="pageFooterNextButton" @click="ui.nav++">Save and Continue</button>
      <button type="submit" data-automation-id="submitButton">Submit</button>
    </div>
    <button type="button" id="rerender" @click="ui.key++">Re-render</button>
    <pre id="state">{{ JSON.stringify(s) }}</pre>
    <p id="nav">{{ ui.nav }}</p>
    <p id="submitted">{{ ui.submitted }}</p>
  </form>`,
}).mount('#app');

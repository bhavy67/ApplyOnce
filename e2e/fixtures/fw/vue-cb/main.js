import { createApp, reactive, ref, computed } from 'vue';

const MODES = [{ value: 'r', label: 'Remote' }, { value: 'h', label: 'Hybrid' }, { value: 'o', label: 'On-site' }];
const TYPES = [{ value: 'ft', label: 'Full time' }, { value: 'pt', label: 'Part time' }, { value: 'c', label: 'Contract' }];
const NOTICE = [{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }];

const Dropdown = {
  props: ['id', 'label', 'options', 'modelValue', 'kind', 'portal'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const open = ref(false);
    const selected = computed(() => props.options.find((o) => o.value === props.modelValue));
    const choose = (value) => { emit('update:modelValue', value); open.value = false; };
    return { open, selected, choose };
  },
  template: `
  <div class="field">
    <label :id="id + '-label'" :for="id">{{ label }}</label>
    <button v-if="kind !== 'input'" type="button" :id="id" aria-haspopup="listbox" :aria-expanded="String(open)" :aria-controls="id + '-listbox'" :aria-labelledby="id + '-label ' + id" @click="open = !open" @keydown.esc="open = false">{{ selected ? selected.label : 'Select…' }}</button>
    <input v-else :id="id" role="combobox" aria-autocomplete="list" :aria-expanded="String(open)" :aria-controls="open ? id + '-listbox' : undefined" :value="selected ? selected.label : ''" @mousedown="open = !open" @keydown.esc="open = false">
    <Teleport to="body" :disabled="!portal">
      <ul v-if="open" role="listbox" :id="id + '-listbox'">
        <li v-for="o in options" :key="o.value" role="option" :data-value="o.value" :aria-selected="o.value === modelValue ? 'true' : 'false'" @click="choose(o.value)">{{ o.label }}</li>
      </ul>
    </Teleport>
  </div>`,
};

createApp({
  components: { Dropdown },
  setup() {
    const s = reactive({ firstName: '', mode: '', etype: '', notice: '60', role: '' });
    const ui = reactive({ modeKey: 0, submitted: false });
    return { s, ui, MODES, TYPES, NOTICE, JSON };
  },
  template: `
  <form @submit.prevent="ui.submitted = true">
    <div class="field"><label for="first">First Name</label><input id="first" name="firstName" v-model="s.firstName"></div>
    <Dropdown :key="'mode-' + ui.modeKey" id="mode" label="Work Mode" :options="MODES" v-model="s.mode" />
    <Dropdown id="etype" label="Employment Type" :options="TYPES" kind="input" :portal="true" v-model="s.etype" />
    <Dropdown id="notice" label="Notice Period" :options="NOTICE" v-model="s.notice" />
    <Dropdown id="role" label="What kind of role are you looking for?" :options="TYPES" v-model="s.role" />
    <button type="button" id="rerender" @click="ui.modeKey++">Re-render work mode</button>
    <button type="submit">Submit</button>
    <pre id="state">{{ JSON.stringify(s) }}</pre>
    <p id="submitted">{{ ui.submitted }}</p>
  </form>`,
}).mount('#app');

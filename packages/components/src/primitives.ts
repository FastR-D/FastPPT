import {
  h,
  mergeProps,
  withDirectives,
  vModelDynamic,
  vModelText,
  vModelSelect,
  type FunctionalComponent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type SVGAttributes,
} from 'vue'

type ElementProps = HTMLAttributes & { as?: string }

// Functional roots deliberately preserve native DOM refs for editors, frames,
// dialogs and resize handles. Styling and control behavior live in this package.
function element(
  name: string,
  tag: string,
  className = '',
): FunctionalComponent<ElementProps> {
  const component: FunctionalComponent<ElementProps> = (
    props,
    { attrs, slots },
  ) =>
    h(
      props.as ?? tag,
      mergeProps(attrs, { class: className }),
      slots.default?.(),
    )
  component.displayName = name
  component.props = ['as']
  component.inheritAttrs = false
  return component
}

export const Box = element('Box', 'div')
export const Text = element('Text', 'span')
export const Heading = element('Heading', 'h2', 'fp-heading')
export const Panel = element('Panel', 'section')
export const ModalBody = element('ModalBody', 'div', 'fp-modal-body')
export const Header = element('Header', 'header')
export const Footer = element('Footer', 'footer')
export const Nav = element('Nav', 'nav')
export const Aside = element('Aside', 'aside')
export const Main = element('Main', 'main')
export const Article = element('Article', 'article')
export const Form = element('Form', 'form')
export const Field = element('Field', 'label', 'fp-field')
export const Fieldset = element('Fieldset', 'fieldset', 'fp-fieldset')
export const Legend = element('Legend', 'legend', 'fp-legend')
export const Disclosure = element('Disclosure', 'details', 'fp-disclosure')
export const DisclosureTrigger: FunctionalComponent<ElementProps & { size?: 'xs' | 'sm' }> = (
  props,
  { attrs, slots },
) => h(props.as ?? 'summary', mergeProps(attrs, {
  class: ['fp-disclosure-trigger', `fp-disclosure-trigger--${props.size ?? 'sm'}`],
}), slots.default?.())
DisclosureTrigger.props = ['as', 'size']
DisclosureTrigger.inheritAttrs = false
export const List = element('List', 'ul')
export const ListItem = element('ListItem', 'li')
export const DescriptionList = element('DescriptionList', 'dl')
export const Term = element('Term', 'dt')
export const Description = element('Description', 'dd')
export const Table = element('Table', 'table', 'fp-table')
export const TableHead = element('TableHead', 'thead')
export const TableBody = element('TableBody', 'tbody')
export const TableRow = element('TableRow', 'tr')
export const TableCell = element('TableCell', 'td')
export const TableHeader = element('TableHeader', 'th')
export const TableCaption = element('TableCaption', 'caption')
export const Frame = element('Frame', 'iframe')
export const Image = element('Image', 'img')
export const DialogSurface = element('DialogSurface', 'dialog', 'fp-dialog')
export const Progress = element('Progress', 'progress', 'fp-progress')
export const Link = element('Link', 'a', 'fp-link')
export const Svg: FunctionalComponent<SVGAttributes> = (
  _props,
  { attrs, slots },
) => h('svg', attrs, slots.default?.())
export const SvgPath: FunctionalComponent<SVGAttributes> = (
  _props,
  { attrs },
) => h('path', attrs)

interface ButtonProps extends HTMLAttributes {
  variant?: 'primary' | 'secondary' | 'quiet' | 'icon' | 'navigation' | 'danger'
  size?: 'xs' | 'sm' | 'md'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
}
export const Button: FunctionalComponent<ButtonProps> = (
  props,
  { attrs, slots },
) =>
  h(
    'button',
    mergeProps(attrs, {
      type: props.type ?? 'button',
      disabled: props.disabled,
      class: [
        'fp-button',
        `fp-button--${props.variant ?? 'secondary'}`,
        `fp-button--${props.size ?? 'sm'}`,
      ],
    }),
    slots.default?.(),
  )
Button.props = ['variant', 'size', 'type', 'disabled']
Button.inheritAttrs = false

interface ModelProps {
  modelValue?: unknown
  modelModifiers?: { number?: boolean; trim?: boolean; lazy?: boolean }
  'onUpdate:modelValue'?: (value: unknown) => void
}
interface TextFieldProps extends Omit<InputHTMLAttributes, 'size'>, ModelProps {
  size?: 'xs' | 'sm' | 'md'
}
export const TextField: FunctionalComponent<TextFieldProps> = (
  props,
  { attrs },
) => {
  const kind = typeof attrs.type === 'string' ? attrs.type : 'text'
  const vnode = h(
    'input',
    mergeProps(attrs, {
      class: [
        'fp-input',
        `fp-input--${kind}`,
        `fp-input--${props.size ?? 'md'}`,
      ],
      'onUpdate:modelValue': props['onUpdate:modelValue'],
    }),
  )
  return props['onUpdate:modelValue']
    ? withDirectives(vnode, [
        [
          vModelDynamic,
          props.modelValue,
          undefined,
          props.modelModifiers ?? {},
        ],
      ])
    : vnode
}
TextField.props = [
  'size',
  'modelValue',
  'modelModifiers',
  'onUpdate:modelValue',
]
TextField.inheritAttrs = false

export const TextArea: FunctionalComponent<
  TextareaHTMLAttributes & ModelProps
> = (props, { attrs }) => {
  const vnode = h(
    'textarea',
    mergeProps(attrs, {
      class: 'fp-textarea',
      'onUpdate:modelValue': props['onUpdate:modelValue'],
    }),
  )
  return props['onUpdate:modelValue']
    ? withDirectives(vnode, [
        [vModelText, props.modelValue, undefined, props.modelModifiers ?? {}],
      ])
    : vnode
}
TextArea.props = ['modelValue', 'modelModifiers', 'onUpdate:modelValue']
TextArea.inheritAttrs = false

export const SelectField: FunctionalComponent<
  SelectHTMLAttributes & ModelProps
> = (props, { attrs, slots }) => {
  const vnode = h(
    'select',
    mergeProps(attrs, {
      class: 'fp-select',
      'onUpdate:modelValue': props['onUpdate:modelValue'],
    }),
    slots.default?.(),
  )
  return props['onUpdate:modelValue']
    ? withDirectives(vnode, [
        [vModelSelect, props.modelValue, undefined, props.modelModifiers ?? {}],
      ])
    : vnode
}
SelectField.props = ['modelValue', 'modelModifiers', 'onUpdate:modelValue']
SelectField.inheritAttrs = false
export const SelectOption = element('SelectOption', 'option')

export const RichText: FunctionalComponent<
  HTMLAttributes & { html: string }
> = (props, { attrs }) => h('div', mergeProps(attrs, { innerHTML: props.html }))
RichText.props = ['html']
RichText.inheritAttrs = false
